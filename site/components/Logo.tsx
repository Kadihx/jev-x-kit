import Image from "next/image";

export default function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <Image
      src="/logo.jpg"
      alt="jev-x-kit"
      width={64}
      height={64}
      className={`${className} rounded-md object-cover`}
    />
  );
}
