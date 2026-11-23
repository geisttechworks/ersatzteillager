import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const removeFirefoxRejectedTextSizeAdjust = {
  postcssPlugin: 'remove-firefox-rejected-text-size-adjust',
  Declaration(declaration) {
    // Tailwind Preflight emits this WebKit-only percentage, which Firefox rejects.
    if (declaration.prop === '-webkit-text-size-adjust' && declaration.value === '100%') {
      declaration.remove();
    }
  }
};

export default {
  plugins: [
    tailwindcss(),
    autoprefixer(),
    removeFirefoxRejectedTextSizeAdjust
  ]
};
