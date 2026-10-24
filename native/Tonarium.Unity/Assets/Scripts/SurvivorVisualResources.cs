using System.Collections.Generic;
using UnityEngine;

namespace Tonarium.UnityClient
{
    // 攻撃エフェクトの生成・破棄に伴うネイティブ側の材質蓄積を防ぐ。
    public sealed class SurvivorVisualResources : MonoBehaviour
    {
        void OnDestroy()
        {
            var materials = new HashSet<Material>();
            foreach (var renderer in GetComponentsInChildren<Renderer>(true))
                if (renderer.GetComponent<TextMesh>() == null && renderer.sharedMaterial != null) materials.Add(renderer.sharedMaterial);
            foreach (var material in materials) Destroy(material);
            foreach (var filter in GetComponentsInChildren<MeshFilter>(true))
                if (filter.sharedMesh != null && filter.sharedMesh.name.StartsWith("Tonarium ")) Destroy(filter.sharedMesh);
        }
    }
}
