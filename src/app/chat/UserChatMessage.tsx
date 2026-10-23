type UserChatMessageProps = {
  text: string;
};

export default function UserChatMessage({ text }: UserChatMessageProps) {
  return (
    <div className="max-w-[90%] self-end rounded-lg bg-[#0047AB] px-3 py-2 text-sm text-white selection:bg-[#FFB74D] wrap-anywhere sm:max-w-[80%]">
      {text}
    </div>
  );
}
