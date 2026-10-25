using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class EyeHeightProvider
    {
        public float Current { get; private set; } = OekakiModel.DefaultEyeHeight;
        public void Update(float target, float dt)
        {
            Current += (target - Current) * (1 - Mathf.Exp(-dt / .2f));
        }
    }
}
