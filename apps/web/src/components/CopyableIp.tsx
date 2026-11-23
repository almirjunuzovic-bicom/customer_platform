import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

function CopyableIp({ ip }: { ip: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ip);
      setCopied(true);
      toast.success(`Copied ${ip}`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      className="group inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
    >
      {ip}
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3 opacity-0 group-hover:opacity-50" />
      )}
    </button>
  );
}

/** Every IP address wherever VPS IPs are shown - click one to copy it. */
export function IpAddressList({ ips }: { ips: string[] | null | undefined }) {
  const list = ips ?? [];
  if (list.length === 0) return <>—</>;
  return (
    <>
      {list.map((ip, i) => (
        <span key={ip}>
          {i > 0 && ", "}
          <CopyableIp ip={ip} />
        </span>
      ))}
    </>
  );
}
