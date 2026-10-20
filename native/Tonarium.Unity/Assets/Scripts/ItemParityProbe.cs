using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class ItemParityProbe : MonoBehaviour
    {
        IEnumerator Start()
        {
            yield return null;
            var world = GetComponent<TonariumWorld>();
            var apply = typeof(TonariumWorld).GetMethod("ApplyItem", BindingFlags.NonPublic | BindingFlags.Instance);
            var output = Path.Combine(Application.persistentDataPath, "item-parity");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--tonarium-output") output = args[i + 1];
            Directory.CreateDirectory(output);
            var checks = new List<string>();
            var specs = new[] {
                new JObject { ["kind"]="note", ["text"]="HTML からネイティブへ\nいっしょに過ごす場所\n末尾が板からはみ出さないことを確認する長文", ["color"]="#fde68a" },
                new JObject { ["kind"]="canvas", ["strokes"]=new JArray(new JObject { ["color"]="#ef4444", ["size"]=10, ["pts"]=new JArray(80,150,180,70,300,200,440,90,540,220) }) },
                new JObject { ["kind"]="g2048", ["grid"]=new JArray(2,4,8,16,32,64,128,256,512,1024,2048,0,0,0,0,0), ["score"]=4096 },
                new JObject { ["kind"]="chess", ["board"]=new JArray("bR","bN","bB","bQ","bK","bB","bN","bR","bP","bP","bP","bP","bP","bP","bP","bP",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,"wP","wP","wP","wP","wP","wP","wP","wP","wR","wN","wB","wQ","wK","wB","wN","wR"), ["chess"]=new JObject{["fen"]="start w"} },
                new JObject { ["kind"]="dice", ["roll"]=new JObject { ["id"]="parity-dice", ["count"]=6, ["sides"]=6, ["at"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-2000, ["results"]=new JArray(1,2,3,4,5,6) } },
                new JObject { ["kind"]="camera" }, new JObject { ["kind"]="hammer" }
            };
            var cameraObject = new GameObject("Item parity camera");
            var camera = cameraObject.AddComponent<Camera>(); camera.fieldOfView=50; camera.nearClipPlane=.03f; camera.farClipPlane=60;
            camera.backgroundColor=new Color(.16f,.17f,.19f); camera.clearFlags=CameraClearFlags.SolidColor;
            var target = new RenderTexture(1280, 960, 24); camera.targetTexture=target;
            for (int i=0;i<specs.Length;i++)
            {
                var item=specs[i]; string kind=(string)item["kind"], id="item-parity-"+kind;
                item["id"]=id; item["x"]=0; item["z"]=-2; item["ry"]=0; apply.Invoke(world,new object[]{item});
                yield return null;
                var root=GameObject.Find("Item "+id);
                if(root==null) throw new InvalidOperationException("missing "+kind);
                camera.transform.position=new Vector3(2.5f,2.7f,-2.5f); camera.transform.LookAt(new Vector3(0,1.1f,2));
                if(kind=="camera" || kind=="hammer") { camera.transform.position=new Vector3(1.5f,1.7f,-.5f); camera.transform.LookAt(new Vector3(0,kind=="hammer"?.2f:1,2)); }
                if(kind=="canvas" || kind=="g2048")
                {
                    var surface=root.GetComponentInChildren<ItemPanelSurface>();
                    if(surface==null || surface.Texture==null) throw new InvalidOperationException("missing surface "+kind);
                    var mesh=surface.GetComponent<MeshFilter>().sharedMesh;
                    if(Mathf.Abs(mesh.bounds.size.y-1.8f)>.001f) throw new InvalidOperationException("panel height "+kind);
                    var ray=new Ray(surface.transform.position+Vector3.back*2,Vector3.forward);
                    if(!surface.GetComponent<Collider>().Raycast(ray,out var hit,3)) throw new InvalidOperationException("panel hit "+kind);
                    if(Vector2.Distance(surface.Point(hit),new Vector2(surface.PixelWidth/2f,surface.PixelHeight/2f))>.1f) throw new InvalidOperationException("panel UV "+kind);
                    checks.Add(kind+": 1.8m panel height, UV center, texture");
                }
                if(kind=="note")
                {
                    var board=root.transform.Find("Note");
                    if(Vector3.Distance(board.localScale,new Vector3(1.6f,1.2f,.04f))>.001f) throw new InvalidOperationException("note size");
                    if(Mathf.Abs(board.localPosition.y-1.5f)>.001f) throw new InvalidOperationException("note height");
                    checks.Add("note: 1.6x1.2m, center 1.5m, two text faces");
                }
                if(kind=="chess" && root.GetComponentsInChildren<ChessSquare>().Length<64) throw new InvalidOperationException("chess squares");
                yield return new WaitForEndOfFrame(); camera.Render(); var previous=RenderTexture.active; RenderTexture.active=target;
                var texture=new Texture2D(1280,960,TextureFormat.RGB24,false); texture.ReadPixels(new Rect(0,0,1280,960),0,0); texture.Apply();
                File.WriteAllBytes(Path.Combine(output,kind+".png"),texture.EncodeToPNG());
                if(kind=="note")
                {
                    camera.transform.position=new Vector3(-2.5f,2.7f,6.5f); camera.transform.LookAt(new Vector3(0,1.1f,2)); camera.Render();
                    texture.ReadPixels(new Rect(0,0,1280,960),0,0); texture.Apply(); File.WriteAllBytes(Path.Combine(output,"note-back.png"),texture.EncodeToPNG());
                }
                Destroy(texture); RenderTexture.active=previous;
                checks.Add(kind+": rendered"); root.SetActive(false); Destroy(root);
            }
            File.WriteAllText(Path.Combine(output,"result.json"),new JObject{["ok"]=true,["checks"]=new JArray(checks)}.ToString());
            camera.targetTexture=null; Destroy(target); Destroy(cameraObject);
            Debug.Log("TONARIUM_ITEM_PARITY_SUCCESS "+output); Application.Quit();
        }
    }
}
