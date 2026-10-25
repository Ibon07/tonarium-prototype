using UnityEngine;

namespace Tonarium.UnityClient
{
    // Three.Sprite と同様にカメラ平面と平行に保つ（俯瞰で文字を回転させない）。
    public sealed class SurvivorBillboard : MonoBehaviour
    {
        void LateUpdate()
        {
            if (Camera.main != null) transform.rotation = Camera.main.transform.rotation;
            else if (Camera.allCameras.Length > 0) transform.rotation = Camera.allCameras[0].transform.rotation;
        }
    }
}
