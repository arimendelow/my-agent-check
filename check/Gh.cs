// A stand-in gh.exe for Windows: hands the agent a fake key and the fake model's address.
public static class Gh {
  public static void Main(string[] args) {
    string all = string.Join(" ", args);
    if (all.StartsWith("auth token")) System.Console.WriteLine("fake-token");
    else if (all.StartsWith("api")) System.Console.WriteLine("http://127.0.0.1:8765");
    else { System.Console.Error.WriteLine("fake gh: unexpected " + all); System.Environment.Exit(1); }
  }
}
