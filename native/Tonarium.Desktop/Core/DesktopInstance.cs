namespace Tonarium.Desktop.Core;

public sealed class DesktopInstance : IDisposable
{
    private readonly FileStream lease;
    public static string RootDirectory { get; private set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tonarium");
    public static string DataDirectory { get; private set; } = RootDirectory;
    public static int Number { get; private set; } = 1;

    private DesktopInstance(FileStream lease) => this.lease = lease;

    public static DesktopInstance Acquire(string? dataRoot = null)
    {
        var root = Path.GetFullPath(dataRoot ?? RootDirectory);
        var instances = Path.Combine(root, "instances");
        Directory.CreateDirectory(instances);
        for (int number = 1; number <= 1024; number++)
        {
            FileStream lease;
            try
            {
                // 終了・クラッシュ時にOSがロックを解放するので、空いた番号を再利用できる。
                lease = new FileStream(Path.Combine(instances, $"{number}.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException e) when ((e.HResult & 0xffff) is 32 or 33 or 11) { continue; }
            try
            {
                var directory = number == 1 ? root : Path.Combine(instances, number.ToString(System.Globalization.CultureInfo.InvariantCulture));
                Directory.CreateDirectory(directory);
                RootDirectory = root;
                DataDirectory = directory;
                Number = number;
                return new DesktopInstance(lease);
            }
            catch { lease.Dispose(); throw; }
        }
        throw new IOException("起動できるクライアント数を超えています。");
    }

    public void Dispose() => lease.Dispose();
}
