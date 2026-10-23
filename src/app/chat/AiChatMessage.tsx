type AiChatMessageProps = {
  text: string;
};

export default function AiChatMessage({ text }: AiChatMessageProps) {
  return (
    <div className="max-w-[90%] self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 transition-opacity opacity-100 wrap-anywhere sm:max-w-[80%]">
      {text}
    </div>
  );
}
