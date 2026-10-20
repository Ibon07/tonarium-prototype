using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class DesktopBridge : MonoBehaviour
    {
        readonly ConcurrentQueue<JObject> incoming = new ConcurrentQueue<JObject>();
        readonly object writeGate = new object();
        TcpClient connection;
        StreamWriter writer;
        Thread receiver;
        volatile bool closing;
        public event Action<JObject> Message;
        public bool Connected => connection != null && connection.Connected && writer != null;
        public string Status { get; private set; } = "スタンドアロン プレビュー";

        void Start()
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "--tonarium-port" && int.TryParse(args[i + 1], out var port))
                {
                    receiver = new Thread(() => Receive(port)) { IsBackground = true, Name = "Tonarium desktop bridge" };
                    receiver.Start();
                    return;
                }
        }

        void Receive(int port)
        {
            try
            {
                connection = new TcpClient();
                connection.Connect("127.0.0.1", port);
                connection.NoDelay = true;
                writer = new StreamWriter(connection.GetStream(), new UTF8Encoding(false)) { AutoFlush = true };
                using (var reader = new StreamReader(connection.GetStream(), Encoding.UTF8))
                {
                    Send(new { t = "ready", version = 1 });
                    Status = "接続済み";
                    while (!closing)
                    {
                        var line = reader.ReadLine();
                        if (line == null) break;
                        incoming.Enqueue(JObject.Parse(line));
                    }
                }
            }
            catch (Exception ex) { if (!closing) Status = "接続: " + ex.Message; }
            finally { if (!closing) incoming.Enqueue(new JObject { ["t"] = "desktopDisconnected" }); }
        }

        public void Send(object message)
        {
            try { lock (writeGate) writer?.WriteLine(JsonConvert.SerializeObject(message)); }
            catch (Exception ex) { Status = ex.Message; }
        }

        void Update()
        {
            int budget = 128;
            while (budget-- > 0 && incoming.TryDequeue(out var message)) Message?.Invoke(message);
        }

        void OnDestroy()
        {
            closing = true;
            connection?.Close();
        }
    }
}
