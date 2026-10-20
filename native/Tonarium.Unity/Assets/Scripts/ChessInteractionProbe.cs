using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class ChessInteractionProbe : MonoBehaviour
    {
        IEnumerator Start()
        {
            yield return null;
            string output = Path.Combine(Application.persistentDataPath, "chess-probe");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--tonarium-output") output = args[i + 1];
            Directory.CreateDirectory(output);
            var checks = new List<string>(); var messages = new JArray();
            try
            {
                var flags = BindingFlags.Instance | BindingFlags.NonPublic;
                var world = GetComponent<TonariumWorld>();
                var click = typeof(TonariumWorld).GetMethod("InteractChessSquare", flags);
                var bridge = (DesktopBridge)typeof(TonariumWorld).GetField("bridge", flags).GetValue(world);
                var writerField = typeof(DesktopBridge).GetField("writer", flags);
                var previousWriter = writerField.GetValue(bridge);
                using (var stream = new MemoryStream())
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                {
                    writerField.SetValue(bridge, writer);
                    try
                    {
                        var items = (Dictionary<string, JObject>)typeof(TonariumWorld).GetField("items", flags).GetValue(world);
                        Action<string, JObject, int> tap = (id, item, square) => { items[id] = item; click.Invoke(world, new object[] { id, item, square }); };
                        Action<string> promote = choice => typeof(TonariumWorld).GetMethod("CompleteChessPromotion", flags).Invoke(world, new object[] { choice });
                        var normal = Board("w", 3, 52, "wP"); tap("board-a", normal, 52); tap("board-a", normal, 36);
                        var white = Board("w", 5, 8, "wP"); long beforeChoice = stream.Length;
                        tap("white-promotion", white, 8); tap("white-promotion", white, 0);
                        if (stream.Length != beforeChoice) throw new InvalidOperationException("Promotion was sent before a piece was chosen.");
                        promote("q");
                        var black = Board("b", 6, 48, "bP"); tap("black-promotion", black, 48); tap("black-promotion", black, 56); promote("q");
                        foreach (string choice in new[] { "n", "r", "b" }) { tap("under-" + choice, white, 8); tap("under-" + choice, white, 0); promote(choice); }
                        tap("board-a", normal, 52); tap("board-b", normal, 52); tap("board-b", normal, 36);
                        tap("revision", normal, 52);
                        var revised = Board("w", 4, 52, "wP"); tap("revision", revised, 36); tap("revision", revised, 52); tap("revision", revised, 36);
                        long beforeCancel = stream.Length;
                        tap("cancelled", white, 8); tap("cancelled", white, 0);
                        typeof(TonariumWorld).GetMethod("ClearChessSelection", flags).Invoke(world, new object[0]); promote("q");
                        tap("stale-promotion", white, 8); tap("stale-promotion", white, 0);
                        items["stale-promotion"] = Board("w", 99, 8, "wP"); promote("q");
                        if (stream.Length != beforeCancel) throw new InvalidOperationException("Cancelled/stale promotion emitted a move.");
                        checks.Add("駒を選ぶまで昇格を送らず、取消・古いrevisionでは送信しない");
                        writer.Flush();
                        foreach (string line in Encoding.UTF8.GetString(stream.ToArray()).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries)) messages.Add(JObject.Parse(line));
                    }
                    finally { writerField.SetValue(bridge, previousWriter); }
                }
                if (messages.Count != 8) throw new InvalidOperationException("Unexpected action count: " + messages.Count);
                var first = (JObject)messages[0]["message"]["action"];
                if ((string)messages[0]["t"] != "room" || (string)messages[0]["message"]["t"] != "itemAction" || first.Property("promotion") != null || (int)first["from"] != 52 || (int)first["to"] != 36 || (int)first["revision"] != 3)
                    throw new InvalidOperationException("Normal move emission is invalid.");
                checks.Add("通常の移動ではpromotionを省略し、選択した駒とrevisionを送る");
                if ((string)messages[1]["message"]["action"]["promotion"] != "q" || (string)messages[2]["message"]["action"]["promotion"] != "q") throw new InvalidOperationException("Promotion must use lowercase q.");
                checks.Add("白と黒のポーン昇格は小文字qを送る");
                if ((string)messages[3]["message"]["action"]["promotion"] != "n" || (string)messages[4]["message"]["action"]["promotion"] != "r" || (string)messages[5]["message"]["action"]["promotion"] != "b") throw new InvalidOperationException("Underpromotion choice was not preserved.");
                checks.Add("ナイト・ルーク・ビショップへの昇格選択を送る");
                if ((string)messages[6]["message"]["id"] != "board-b" || (int)messages[6]["message"]["action"]["from"] != 52) throw new InvalidOperationException("Selection crossed board identities.");
                checks.Add("別の盤を選ぶと選択元を切り替える");
                if ((int)messages[7]["message"]["action"]["revision"] != 4 || (int)messages[7]["message"]["action"]["from"] != 52) throw new InvalidOperationException("Stale selection crossed revisions.");
                checks.Add("盤の更新後は古い選択を送らず、選び直した手を送る");
                File.WriteAllText(Path.Combine(output, "chess-probe.json"), new JObject { ["ok"] = true, ["checks"] = new JArray(checks), ["emitted"] = messages }.ToString());
                Debug.Log("TONARIUM_CHESS_PROBE_SUCCESS " + output); Application.Quit();
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(output, "chess-probe.json"), new JObject { ["ok"] = false, ["error"] = error.ToString(), ["checks"] = new JArray(checks), ["emitted"] = messages }.ToString());
                Debug.LogException(error); Application.Quit(1);
            }
        }
        static JObject Board(string turn, int revision, int square, string piece)
        {
            var board = new JArray(Enumerable.Repeat<string>(null, 64)); board[square] = piece;
            return new JObject { ["kind"] = "chess", ["board"] = board, ["chess"] = new JObject { ["fen"] = "8/8/8/8/8/8/8/8 " + turn + " - - 0 1", ["revision"] = revision } };
        }
    }
}
