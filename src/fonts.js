// Шрифты для текста песни. Все вшиты в программу и поддерживают казахские буквы.
// scale выравнивает видимый размер: у разных шрифтов буквы разной величины.
export const FONTS = {
  inter: { name: 'Inter', family: '"Inter Variable"', weight: 800, scale: 1 },
  montserrat: { name: 'Montserrat', family: '"Montserrat Variable"', weight: 800, scale: 0.96 },
  rubik: { name: 'Rubik — мягкий', family: '"Rubik Variable"', weight: 800, scale: 1 },
  oswald: { name: 'Oswald — узкий', family: '"Oswald Variable"', weight: 700, scale: 1.08 },
  unbounded: { name: 'Unbounded — широкий', family: '"Unbounded Variable"', weight: 700, scale: 0.82 },
  comfortaa: { name: 'Comfortaa — круглый', family: '"Comfortaa Variable"', weight: 700, scale: 0.94 },
  caveat: { name: 'Caveat — от руки', family: '"Caveat Variable"', weight: 700, scale: 1.3 },
  lobster: { name: 'Lobster — с завитками', family: '"Lobster"', weight: 400, scale: 1.12 },
  mono: { name: 'JetBrains Mono — машинка', family: '"JetBrains Mono Variable"', weight: 800, scale: 0.9 },
};

const FALLBACK = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif';

export const fontOf = (key, fallbackKey) => FONTS[key] || FONTS[fallbackKey] || FONTS.inter;
export const cssFont = (spec, size) => `${spec.weight} ${size}px ${spec.family}, ${FALLBACK}`;

export const loadFonts = () => Promise.allSettled(Object.values(FONTS).map((f) => document.fonts.load(`${f.weight} 60px ${f.family}`, 'AaЯяӘәҚқ')));
