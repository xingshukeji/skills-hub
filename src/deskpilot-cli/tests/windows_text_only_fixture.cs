// Optional Windows Development fixture. The shipped DeskPilot runtime is Python;
// this uses the OS's WPF framework only to expose a real TextPattern-only provider.
using System;
using System.Diagnostics;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Interop;

public sealed class TextOnlyBox : TextBox
{
    protected override AutomationPeer OnCreateAutomationPeer()
    {
        return new TextOnlyPeer(this);
    }
}

public sealed class TextOnlyPeer : TextBoxAutomationPeer
{
    public TextOnlyPeer(TextBox owner) : base(owner) { }

    public override object GetPattern(PatternInterface pattern)
    {
        // UI Automation may read and select text, but cannot use ValuePattern.
        return pattern == PatternInterface.Value ? null : base.GetPattern(pattern);
    }
}

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var app = new Application();
        var window = new Window { Title = args[0], Width = 850, Height = 450, Left = 340, Top = 220 };
        var input = new TextOnlyBox { Text = "First line\r\nSecond line", AcceptsReturn = true,
                                     TextWrapping = TextWrapping.Wrap, FontSize = 24,
                                     Margin = new Thickness(30), VerticalAlignment = VerticalAlignment.Top,
                                     Height = 150 };
        input.IsReadOnly = args.Length > 1 && args[1] == "--read-only";
        AutomationProperties.SetAutomationId(input, "text-only");
        AutomationProperties.SetName(input, "Text-only editable fixture");
        window.Content = input;
        window.Loaded += delegate
        {
            Console.WriteLine("{\"ready\":true,\"pid\":" + Process.GetCurrentProcess().Id +
                              ",\"handle\":" + new WindowInteropHelper(window).Handle.ToInt64() + "}");
            Console.Out.Flush();
        };
        app.Run(window);
    }
}
