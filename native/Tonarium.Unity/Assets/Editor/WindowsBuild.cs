using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Tonarium.UnityClient.Editor
{
    public static class WindowsBuild
    {
        public static void Build()
        {
            Directory.CreateDirectory("Assets/Scenes");
            Directory.CreateDirectory("Assets/Resources");
            foreach (var shaderName in new[] { "Standard", "Unlit/Transparent Cutout", "Unlit/Transparent", "Unlit/Texture", "Sprites/Default" })
            {
                string assetPath = "Assets/Resources/" + shaderName.Replace('/', '_').Replace(' ', '_') + ".mat";
                if (AssetDatabase.LoadAssetAtPath<Material>(assetPath) == null)
                    AssetDatabase.CreateAsset(new Material(Shader.Find(shaderName)), assetPath);
            }
            AssetDatabase.SaveAssets();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var root = new GameObject("Tonarium");
            root.AddComponent<TonariumWorld>();
            EditorSceneManager.SaveScene(root.scene, "Assets/Scenes/Tonarium.unity");
            PlayerSettings.companyName = "Tonarium";
            PlayerSettings.productName = "Tonarium 3D";
            var icon = Resources.Load<Texture2D>("Web/Brand/favicon");
            if(icon!=null)PlayerSettings.SetIconsForTargetGroup(BuildTargetGroup.Standalone,new[]{icon});
            PlayerSettings.runInBackground = true;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 800;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Standalone, ScriptingImplementation.Mono2x);
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.stripEngineCode = false;
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../build/unity/Tonarium3D.exe"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                scenes = new[] { "Assets/Scenes/Tonarium.unity" }, locationPathName = output,
                target = BuildTarget.StandaloneWindows64, options = BuildOptions.None
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new Exception("Unity build failed: " + report.summary.result);
            Debug.Log("TONARIUM_BUILD_SUCCESS " + output);
        }
    }
}
