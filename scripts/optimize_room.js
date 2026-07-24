const fs = require('fs');
const path = require('path');

const originalPath = path.resolve(__dirname, '../assets/models/room_foundation.glb.bak');
const outputPath = path.resolve(__dirname, '../assets/models/room_foundation.glb');

async function main() {
  console.log('Loading gltf-transform APIs and Draco dependencies...');
  const { NodeIO } = await import('@gltf-transform/core');
  const { resize, draco } = await import('@gltf-transform/functions');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const draco3d = require('draco3dgltf');

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
  portalTextures.forEach((tex, idx) => {
    const data = {
      name: tex.getName(),
      mimeType: tex.getMimeType(),
      image: tex.getImage(),
      slots: []
    };

    // Find all materials using this texture and detach them
    const materials = root.listMaterials();
    materials.forEach(mat => {
      if (mat.getBaseColorTexture() === tex) {
        data.slots.push({ material: mat, slot: 'baseColor' });
        mat.setBaseColorTexture(null);
      }
      if (mat.getEmissiveTexture() === tex) {
        data.slots.push({ material: mat, slot: 'emissive' });
        mat.setEmissiveTexture(null);
      }
      if (mat.getNormalTexture() === tex) {
        data.slots.push({ material: mat, slot: 'normal' });
        mat.setNormalTexture(null);
      }
    });

    savedPortalData.push(data);
    
    // Dispose of the texture so it is removed from the document before resizing
    tex.dispose();
  });

  console.log(`Detached ${savedPortalData.length} portal texture(s) from materials.`);

  console.log('Resizing all other textures to 256x256...');
  // Resize remaining textures
  await document.transform(
    resize({ size: [256, 256] })
  );

  console.log('Restoring protected portal textures...');
  // Restore and re-attach portal textures
  savedPortalData.forEach(data => {
    const newTex = document.createTexture(data.name)
      .setImage(data.image)
      .setMimeType(data.mimeType);

    data.slots.forEach(({ material, slot }) => {
      if (slot === 'baseColor') {
        material.setBaseColorTexture(newTex);
      } else if (slot === 'emissive') {
        material.setEmissiveTexture(newTex);
      } else if (slot === 'normal') {
        material.setNormalTexture(newTex);
      }
    });
    console.log(`-> Restored and re-attached "${data.name}" to ${data.slots.length} material slots.`);
  });

  console.log('Applying Draco geometry compression...');
  // Re-apply draco compression
  await document.transform(
    draco()
  );

  console.log('Writing optimized GLB...');
  await io.write(outputPath, document);
  console.log('Optimization complete!');
}

main().catch(err => {
  console.error('Error running optimization:', err);
  process.exit(1);
});
