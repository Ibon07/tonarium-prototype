const fs = require('fs');
const path = require('path');
const draco = require(path.resolve(__dirname, '../../../node_modules/draco3d'));

(async () => {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../../client/public/oekaki/avatar.glb'));
  const jsonSize = bytes.readUInt32LE(12);
  const source = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const bin = bytes.subarray(28 + jsonSize);
  const decoderModule = await draco.createDecoderModule();
  const meshes = [];
  for (const mesh of source.meshes) {
    const prim = mesh.primitives[0];
    const extension = prim.extensions.KHR_draco_mesh_compression;
    const view = source.bufferViews[extension.bufferView];
    const compressed = bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    const buffer = new decoderModule.DecoderBuffer();
    buffer.Init(compressed, compressed.length);
    const decoder = new decoderModule.Decoder();
    const decoded = new decoderModule.Mesh();
    const result = decoder.DecodeBufferToMesh(buffer, decoded);
    if (!result.ok()) throw new Error(result.error_msg());
    const item = {};
    for (const [name, id] of Object.entries(extension.attributes)) {
      const attr = decoder.GetAttributeByUniqueId(decoded, id);
      const values = new decoderModule.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(decoded, attr, values);
      item[name] = Array.from({length: values.size()}, (_, i) => values.GetValue(i));
      decoderModule.destroy(values);
    }
    const indices = new decoderModule.DracoInt32Array();
    item.indices = [];
    for (let i = 0; i < decoded.num_faces(); i++) {
      decoder.GetFaceFromMesh(decoded, i, indices);
      item.indices.push(indices.GetValue(0), indices.GetValue(1), indices.GetValue(2));
    }
    meshes.push(item);
    for (const object of [indices, decoded, decoder, buffer]) decoderModule.destroy(object);
  }
  const out = {nodes: source.nodes, scenes: source.scenes, meshes};
  fs.writeFileSync(path.resolve(__dirname, '../Assets/Resources/OekakiGeometry.json'), JSON.stringify(out));
  console.log(`Converted ${meshes.length} original oekaki avatar meshes`);
})();
