"use client";

import type { AvatarAttributes } from "../../types";
import { normalizeAvatarAttributes } from "../../lib/avatar";

// ---------------------------------------------------------------------------
// DLX Avatar Visual — a real layered SVG avatar character.
//
// Every persisted avatar attribute maps to a visible part of the character:
//   · skinTone      -> face / neck / ear colour
//   · hairStyle     -> hair silhouette (short, mid, long, curly, braids, shaved)
//   · hairColor     -> hair fill
//   · presentation  -> clothing style + colour
//   · build         -> shoulder/body width
//   · clothingSize  -> overall body scale
//   · height        -> vertical body proportion
//   · facePreset    -> eyebrows + mouth expression
//
// The component fills its parent box (SVG viewBox 0 0 220 220), so it renders
// crisply at every size from a 24 px header badge to a full editor preview.
// ---------------------------------------------------------------------------

const skinToneHex: Record<string, string> = {
  "Très clair": "#f6d4ac",
  Clair: "#e8b98c",
  Médium: "#c6823f",
  Foncé: "#8a5528",
  "Très foncé": "#5f3b1e",
};

const hairColorHex: Record<string, string> = {
  Noir: "#181614",
  "Brun foncé": "#3b2a1c",
  Brun: "#543421",
  Blond: "#d9a441",
  Roux: "#b45a2c",
  Gris: "#b9bbb6",
};

const buildScale: Record<string, number> = {
  Svelte: 0.86,
  Athlétique: 1,
  Moyenne: 1.06,
  Robuste: 1.16,
};

const clothingScale: Record<string, number> = {
  XS: 0.94,
  S: 0.98,
  M: 1.02,
  L: 1.06,
  XL: 1.1,
  XXL: 1.16,
};

const heightScale: Record<string, number> = {
  "Petit(e)": 0.94,
  "Moyen(ne) (1,60-1,75 m)": 1,
  "Grand(e) (1,75 m et +)": 1.05,
};

const presentationStyle: Record<
  string,
  { torso: string; shade: string; accent: string; pattern: "crew" | "vneck" | "hoodie" | "shirt" | "dashiki" }
> = {
  Casual: { torso: "#2a3550", shade: "#181f33", accent: "#e2b13c", pattern: "crew" },
  Élégant: { torso: "#232050", shade: "#141233", accent: "#e2b13c", pattern: "vneck" },
  Sportif: { torso: "#9a3412", shade: "#6f250c", accent: "#fbbf24", pattern: "hoodie" },
  Professionnel: { torso: "#23272e", shade: "#121417", accent: "#d9dde3", pattern: "shirt" },
  Traditionnel: { torso: "#5a2430", shade: "#3d1720", accent: "#e7c269", pattern: "dashiki" },
};

const facePresets: Record<
  string,
  { brows: "relaxed" | "confident" | "neutral" | "playful"; mouth: string; filled: boolean }
> = {
  Amical: { brows: "relaxed", mouth: "M100 109 Q110 117 120 109", filled: false },
  Confiant: { brows: "confident", mouth: "M101 109 Q110 118 119 108", filled: false },
  Souriant: { brows: "relaxed", mouth: "M99 109 Q110 121 121 109 Q110 113 99 109 Z", filled: true },
  Neutre: { brows: "neutral", mouth: "M101 111 L119 111", filled: false },
  Espiègle: { brows: "playful", mouth: "M98 112 Q110 119 121 107", filled: false },
};

type BrowKind = "relaxed" | "confident" | "neutral" | "playful";
const browPaths: Record<BrowKind, { left: string; right: string }> = {
  relaxed: { left: "M92 84 Q97 81 102 84", right: "M118 84 Q123 81 128 84" },
  confident: { left: "M91 83 Q96 79 101 85", right: "M119 82 Q124 78 129 84" },
  neutral: { left: "M92 84 L102 84", right: "M118 84 L128 84" },
  playful: { left: "M91 82 Q96 78 101 83", right: "M118 85 Q123 83 128 87" },
};

export function AvatarVisual({
  attributes,
  className = "",
  showBackdrop = true,
}: {
  attributes: Partial<AvatarAttributes> | null | undefined;
  className?: string;
  showBackdrop?: boolean;
}) {
  const a = normalizeAvatarAttributes(attributes);
  const skin = skinToneHex[a.skinTone] ?? "#c6823f";
  const hair = hairColorHex[a.hairColor] ?? "#181614";
  const build = buildScale[a.build] ?? 1;
  const clothing = clothingScale[a.clothingSize] ?? 1;
  const height = heightScale[a.height] ?? 1;
  const outfit = presentationStyle[a.presentation] ?? presentationStyle.Casual;
  const face = facePresets[a.facePreset] ?? facePresets.Amical;
  const brows = browPaths[face.brows];

  const hairStyle = a.hairStyle ?? "Court";
  const half = 52 * build * clothing; // shoulder half-width
  const torsoTop = 146 - height * 6; // taller => slightly higher shoulders in frame

  return (
    <svg
      viewBox="0 0 220 220"
      className={className}
      role="img"
      aria-label={a.presentation}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="dlxAvaBg" cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </radialGradient>
        <linearGradient id="dlxAvaTorso" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={outfit.torso} />
          <stop offset="100%" stopColor={outfit.shade} />
        </linearGradient>
      </defs>

      {showBackdrop && (
        <>
          <circle cx="110" cy="112" r="92" fill="url(#dlxAvaBg)" />
          <circle cx="110" cy="112" r="92" fill="none" stroke="#000000" strokeOpacity="0.18" strokeWidth="1.5" />
        </>
      )}
{/* ---- Torso / clothing ---- */}
      <path
        d={`M ${110 - half} 220 L ${110 - half} ${torsoTop + 26} C ${110 - half} ${torsoTop + 6} ${
          110 - half * 0.66
        } ${torsoTop - 2} ${110 - 26} ${torsoTop} Q ${110} ${torsoTop + 14} ${110 + 26} ${torsoTop} C ${
          110 + half * 0.66
        } ${torsoTop - 2} ${110 + half} ${torsoTop + 6} ${110 + half} ${torsoTop + 26} L ${110 + half} 220 Z`}
        fill="url(#dlxAvaTorso)"
      />

      {/* Clothing accent / neckline */}
      {outfit.pattern === "crew" && (
        <path
          d={`M ${110 - 20} ${torsoTop} L ${110 + 20} ${torsoTop} L ${110 + 15} ${torsoTop - 8} C ${110 + 9} ${
            torsoTop - 13
          } ${110 - 9} ${torsoTop - 13} ${110 - 15} ${torsoTop - 8} Z`}
          fill={outfit.accent}
        />
      )}
      {outfit.pattern === "vneck" && (
        <>
          <path d={`M ${110 - 21} ${torsoTop - 1} L ${110 + 21} ${torsoTop - 1} L ${110} ${torsoTop + 22} Z`} fill={outfit.accent} opacity="0.92" />
          <path d={`M ${110} ${torsoTop - 1} L ${110} ${torsoTop + 22}`} stroke="#000" strokeOpacity="0.25" strokeWidth="1.5" />
        </>
      )}
      {outfit.pattern === "hoodie" && (
        <>
          <path d={`M ${110 - 21} ${torsoTop} L ${110 + 21} ${torsoTop}`} stroke={outfit.accent} strokeWidth="4" strokeLinecap="round" />
          <path d="M 104 148 C 103 156 106 161 107 164" stroke="#000" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M 116 148 C 117 156 114 162 113 165" stroke="#000" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {outfit.pattern === "shirt" && (
        <>
          <path
            d={`M ${110 - 20} ${torsoTop} L ${110 + 20} ${torsoTop} L ${110 + 15} ${torsoTop - 8} C ${110 + 9} ${
              torsoTop - 13
            } ${110 - 9} ${torsoTop - 13} ${110 - 15} ${torsoTop - 8} Z`}
            fill={outfit.accent}
          />
          <path d={`M ${110} ${torsoTop - 6} L ${105} ${torsoTop + 14} L ${110} ${torsoTop + 18} L ${115} ${torsoTop + 14} Z`} fill="#e2b13c" />
        </>
      )}
      {outfit.pattern === "dashiki" && (
        <>
          <path d={`M ${110 - 22} ${torsoTop} Q ${110} ${torsoTop + 14} ${110 + 22} ${torsoTop}`} fill="none" stroke={outfit.accent} strokeWidth="4" strokeLinecap="round" />
          {[0, 1, 2].map((i) => (
            <g key={i} fill={outfit.accent} opacity="0.8">
              <circle cx={110 - 30 - i * 9} cy={torsoTop + 24 + i * 14} r="2.4" />
              <circle cx={110 + 30 + i * 9} cy={torsoTop + 24 + i * 14} r="2.4" />
            </g>
          ))}
        </>
      )}
{/* ---- Back hair (long/braids fall behind the head but over the torso) ---- */}
      {(hairStyle === "Long" || hairStyle === "Tresses") && (
        <>
          <path d="M 76 88 C 72 106 74 128 83 142 L 89 130 C 84 114 84 100 87 90 Z" fill={hair} />
          <path d="M 144 88 C 148 106 146 128 137 142 L 131 130 C 136 114 136 100 133 90 Z" fill={hair} />
        </>
      )}
      {hairStyle === "Tresses" && (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <path d={`M ${79 + i * 4} 92 C ${77 + i * 4} 104 ${79 + i * 4} 116 ${81 + i * 4} 124`} fill="none" stroke={hair} strokeWidth="3.5" strokeLinecap="round" />
              <path d={`M ${141 - i * 4} 92 C ${143 - i * 4} 104 ${141 - i * 4} 116 ${139 - i * 4} 124`} fill="none" stroke={hair} strokeWidth="3.5" strokeLinecap="round" />
            </g>
          ))}
        </>
      )}
      {hairStyle === "Long" && (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i} stroke={hair} strokeWidth="1.4" opacity="0.7">
              <path d={`M ${80 + i * 3} 96 C ${79 + i * 3} 110 ${81 + i * 3} 122 ${84 + i * 3} 132`} fill="none" strokeLinecap="round" />
              <path d={`M ${140 - i * 3} 96 C ${141 - i * 3} 110 ${139 - i * 3} 122 ${136 - i * 3} 132`} fill="none" strokeLinecap="round" />
            </g>
          ))}
        </>
      )}
      {hairStyle === "Mi-long" && (
        <>
          <path d="M 77 88 C 73 100 75 114 82 118 L 85 106 C 83 100 83 94 85 90 Z" fill={hair} />
          <path d="M 143 88 C 147 100 145 114 138 118 L 135 106 C 137 100 137 94 135 90 Z" fill={hair} />
        </>
      )}

      {/* ---- Neck ---- */}
      <rect x="97" y="118" width="26" height="36" rx="10" fill={skin} />
      <rect x="109" y="118" width="14" height="36" rx="10" fill="#000" opacity="0.12" />
      <ellipse cx="110" cy="136" rx="20" ry="5" fill="#000" opacity="0.18" />

      {/* ---- Ears ---- */}
      <ellipse cx="75" cy="96" rx="6" ry="9" fill={skin} />
      <ellipse cx="145" cy="96" rx="6" ry="9" fill={skin} />
      <ellipse cx="76" cy="97" rx="2" ry="3.5" fill="#000" opacity="0.15" />
      <ellipse cx="144" cy="97" rx="2" ry="3.5" fill="#000" opacity="0.15" />

      {/* ---- Head ---- */}
      <ellipse cx="110" cy="92" rx="34" ry="37" fill={skin} />

      {/* ---- Front hair cap (crown) ---- */}
      {hairStyle === "Rasé" ? (
        <path
          d="M 76 92 C 74 58 88 44 110 44 C 132 44 146 58 144 92 C 141 70 134 60 110 60 C 86 60 79 70 76 92 Z"
          fill={hair}
        />
      ) : (
        <path
          d="M 76 92 C 74 60 88 46 110 46 C 132 46 146 60 144 92 C 139 78 130 72 110 72 C 90 72 81 78 76 92 Z"
          fill={hair}
        />
      )}
      {hairStyle === "Court" && (
        <>
          <path d="M 80 86 C 77 92 79 98 82 100 L 84 92 C 83 89 82 87 82 86 Z" fill={hair} />
          <path d="M 140 86 C 143 92 141 98 138 100 L 136 92 C 137 89 138 87 138 86 Z" fill={hair} />
        </>
      )}
      {hairStyle === "Bouclé" && (
        <>
          <circle cx="83" cy="68" r="9" fill={hair} />
          <circle cx="97" cy="57" r="11" fill={hair} />
          <circle cx="123" cy="57" r="11" fill={hair} />
          <circle cx="137" cy="68" r="9" fill={hair} />
          <circle cx="110" cy="55" r="9" fill={hair} />
        </>
      )}
      {hairStyle === "Tresses" && (
        <>
          <path d="M 78 88 C 77 82 79 76 84 71 L 89 66" fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" opacity="0.35" />
          <path d="M 142 88 C 143 82 141 76 136 71 L 131 66" fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" opacity="0.35" />
        </>
      )}

      {/* ---- Face ---- */}
      {/* Eyebrows */}
      <path d={brows.left} fill="none" stroke={hair} strokeWidth="2.6" strokeLinecap="round" />
      <path d={brows.right} fill="none" stroke={hair} strokeWidth="2.6" strokeLinecap="round" />

      {/* Eyes */}
      <ellipse cx="98" cy="95" rx="5.4" ry="6.4" fill="#ffffff" />
      <ellipse cx="122" cy="95" rx="5.4" ry="6.4" fill="#ffffff" />
      <circle cx="98.7" cy="95.8" r="2.7" fill="#23201c" />
      <circle cx="122.7" cy="95.8" r="2.7" fill="#23201c" />
      <circle cx="100.2" cy="94.5" r="0.9" fill="#ffffff" />
      <circle cx="124.2" cy="94.5" r="0.9" fill="#ffffff" />

      {/* Nose */}
      <path d="M 110 97 C 111.5 100.5 111.5 103 109.5 104" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="2" strokeLinecap="round" />

      {/* Mouth */}
      {face.filled ? (
        <path d={face.mouth} fill="#7a3a2c" stroke="#5b2417" strokeWidth="1" />
      ) : (
        <path d={face.mouth} fill="none" stroke="#4d2c22" strokeWidth="2.6" strokeLinecap="round" />
      )}
    </svg>
  );
}