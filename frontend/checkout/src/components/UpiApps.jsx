/**
 * Simple brand-styled UPI app marks (self-contained SVG, no external assets).
 * Each is a rounded tile with the app's initial and brand color — enough to
 * be recognizable in the checkout without shipping copyrighted logos.
 */
function Tile({ bg, children, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${bg} text-sm font-bold text-white shadow-sm`}>
        {children}
      </span>
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  );
}

export const PhonePeIcon = () => <Tile bg="bg-[#5f259f]" label="PhonePe">Pe</Tile>;
export const GPayIcon = () => (
  <Tile bg="bg-white ring-1 ring-gray-200" label="GPay">
    <span className="bg-gradient-to-r from-[#4285F4] via-[#EA4335] to-[#34A853] bg-clip-text text-transparent">G</span>
  </Tile>
);
export const PaytmIcon = () => <Tile bg="bg-[#00baf2]" label="Paytm">P</Tile>;
export const BhimIcon = () => <Tile bg="bg-[#00537e]" label="BHIM">B</Tile>;

export function UpiAppRow() {
  return (
    <div className="flex items-center justify-center gap-5">
      <PhonePeIcon />
      <GPayIcon />
      <PaytmIcon />
      <BhimIcon />
    </div>
  );
}
