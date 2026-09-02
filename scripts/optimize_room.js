const fs = require('fs');
const path = require('path');

const originalPath = path.resolve(__dirname, '../assets/models/final.glb.bak');
const outputPath = path.resolve(__dirname, '../assets/models/final.glb');

const TEXTURE_SLOTS = [
  ['getBaseColorTexture', 'setBaseColorTexture', 'baseColor'],
  ['getEmissiveTexture', 'setEmissiveTexture', 'emissive'],
  ['getNormalTexture', 'setNormalTexture', 'normal'],
  ['getOcclusionTexture', 'setOcclusionTexture', 'occlusion'],
  ['getMetallicRoughnessTexture', 'setMetallicRoughnessTexture', 'metallicRoughness'],
];

async function main() {
  if (!fs.existsSync(originalPath)) {
    if (!fs.existsSync(outputPath)) {
      throw new Error('Neither final.glb.bak nor final.glb found');
    }
    console.log('Creating backup of original final.glb...');
    fs.copyFileSync(outputPath, originalPath);
  }

  console.log('Loading gltf-transform APIs and Draco dependencies...');
  const { NodeIO } = await import('@gltf-transform/core');
  const { textureCompress, draco } = await import('@gltf-transform/functions');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const draco3d = require('draco3dgltf');
  const sharp = require('sharp');

  console.log('Reading original room GLB...');
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule()
    });

  const document = await io.read(originalPath);
  const root = document.getRoot();

  console.log('Finding portal animated textures to protect...');
  const textures = root.listTextures();
  const portalTextures = [];

  textures.forEach(tex => {
    const name = tex.getName();
    if (name.includes('Portal')) {
      console.log(`-> Found portal texture to protect: "${name}" (${tex.getMimeType()})`);
      portalTextures.push(tex);
    }
  });

  if (portalTextures.length === 0) {
    console.warn('Warning: No portal textures found with name "Portal".');
  }

  // Save portal textures details and detach them from materials
  const savedPortalData = [];
  portalTextures.forEach((tex) => {
    const data = {
      name: tex.getName(),
      mimeType: tex.getMimeType(),
      image: tex.getImage(),
      slots: []
    };

    const materials = root.listMaterials();
    materials.forEach(mat => {
      TEXTURE_SLOTS.forEach(([getter, setter, slot]) => {
        if (typeof mat[getter] === 'function' && mat[getter]() === tex) {
          data.slots.push({ material: mat, slot });
          mat[setter](null);
        }
      });
    });

    savedPortalData.push(data);

    // Dispose of the texture so it is removed from the document before resizing
    tex.dispose();
  });

  console.log(`Detached ${savedPortalData.length} portal texture(s) from materials.`);

  console.log('Resizing remaining textures to 256x256 and converting to WebP...');
  await document.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [256, 256],
    })
  );

  console.log('Restoring protected portal textures...');
  savedPortalData.forEach(data => {
    const newTex = document.createTexture(data.name)
      .setImage(data.image)
      .setMimeType(data.mimeType);

    data.slots.forEach(({ material, slot }) => {
      const setter = TEXTURE_SLOTS.find((entry) => entry[2] === slot)?.[1];
      if (setter) {
        material[setter](newTex);
      }
    });
    console.log(`-> Restored and re-attached "${data.name}" to ${data.slots.length} material slots.`);
  });

  console.log('Applying Draco geometry compression...');
  await document.transform(
    draco()
  );

  console.log('Writing optimized GLB...');
  await io.write(outputPath, document);
  const srcSize = fs.statSync(originalPath).size;
  const dstSize = fs.statSync(outputPath).size;
  console.log(`Optimization complete! ${ (srcSize / 1024 / 1024).toFixed(2) } MB → ${ (dstSize / 1024 / 1024).toFixed(2) } MB`);
}

main().catch(err => {
  console.error('Error running optimization:', err);
  process.exit(1);
});
