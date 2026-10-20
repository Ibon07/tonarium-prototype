using System.Buffers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using MessagePack;

namespace Tonarium.Desktop.Core;

/// <summary>Matches shared/session-wire.ts byte-for-byte (MessagePack + AES-256-GCM).</summary>
internal static class SessionPacket
{
    public const string Topic = "tonarium.v1";
    public const int MaxBytes = 32 * 1024 * 1024;
    public const int BlobThreshold = 48 * 1024;

    public static object? ToWire(JsonNode? value) => value switch
    {
        null => null,
        JsonObject obj => obj.ToDictionary(k => k.Key, k => ToWire(k.Value)),
        JsonArray arr => arr.Select(ToWire).ToArray(),
        _ => FromElement(JsonSerializer.SerializeToElement(value))
    };

    private static object? FromElement(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => value.TryGetInt64(out var integer) ? integer : value.GetDouble(),
        _ => null
    };

    private static byte[] Aad(string grant, string lane, long sequence)
    {
        var buffer = new ArrayBufferWriter<byte>();
        var writer = new MessagePackWriter(buffer);
        writer.WriteArrayHeader(4);
        writer.Write(Topic);
        writer.Write(grant);
        writer.Write(lane);
        writer.Write(sequence);
        writer.Flush();
        return buffer.WrittenSpan.ToArray();
    }

    public static Dictionary<string, object?> Seal(byte[] key, string grant, string lane, long sequence, JsonObject value)
    {
        var bytes = KokoSync.Wire.Encode((Dictionary<string, object?>)ToWire(value)!, MaxBytes - 1024);
        var iv = RandomNumberGenerator.GetBytes(12);
        var body = new byte[bytes.Length + 16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(iv, bytes, body.AsSpan(0, bytes.Length), body.AsSpan(bytes.Length), Aad(grant, lane, sequence));
        return new() { ["grant"] = grant, ["lane"] = lane, ["seq"] = sequence, ["iv"] = iv, ["body"] = body };
    }

    public static (long Sequence, JsonObject Value) Open(byte[] key, string grant, string lane, Dictionary<string, object?> packet)
    {
        if (packet.GetValueOrDefault("grant") as string != grant || packet.GetValueOrDefault("lane") as string != lane ||
            packet.GetValueOrDefault("iv") is not byte[] { Length: 12 } iv ||
            packet.GetValueOrDefault("body") is not byte[] body || body.Length < 16 || body.Length > MaxBytes)
            throw new IOException("Invalid encrypted session packet.");
        var sequence = Convert.ToInt64(packet["seq"]);
        if (sequence < 1 || sequence > 9007199254740991L) throw new IOException("Invalid packet sequence.");
        var bytes = new byte[body.Length - 16];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(iv, body.AsSpan(0, bytes.Length), body.AsSpan(bytes.Length), bytes, Aad(grant, lane, sequence));
        var result = KokoSync.Wire.Decode(bytes, MaxBytes);
        return (sequence, JsonSerializer.SerializeToNode(result)!.AsObject());
    }
}
