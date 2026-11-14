// Shows plain-language help only in beginner mode. Owner: LEAD (text by GEO).
import { useApp } from "../../state/store";

export default function ExplainCard({ text }: { text: string }) {
  const mode = useApp((s) => s.mode);
  if (mode !== "beginner") return null;
  return <p className="explain">{text}</p>;
}
