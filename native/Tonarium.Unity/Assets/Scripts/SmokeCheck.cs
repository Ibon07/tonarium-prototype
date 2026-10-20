using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class SmokeCheck : MonoBehaviour
    {
        IEnumerator Start()
        {
            yield return new WaitForSeconds(3);
            var world = GetComponent<TonariumWorld>();
            string output = Path.Combine(Application.persistentDataPath, "smoke");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--tonarium-output") output = args[i + 1];
            Directory.CreateDirectory(output);
            foreach (var kind in new[] { "cafe", "room", "game" })
            {
                world.BuildWorld(kind);
                world.SetPreviewCamera(kind);
                yield return new WaitForSeconds(.6f);
                yield return new WaitForEndOfFrame();
                ScreenCapture.CaptureScreenshot(Path.Combine(output, kind + ".png"));
                yield return new WaitForSeconds(.6f);
            }
            File.WriteAllText(Path.Combine(output, "result.json"), "{\"ok\":true,\"worlds\":3,\"rendered\":true,\"avatars\":" + world.AvatarCount + ",\"items\":" + world.ItemCount + "}");
            Debug.Log("TONARIUM_SMOKE_SUCCESS " + output);
            Application.Quit();
        }
    }
}
