/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: false,
  content: [
    './Flogination/flogination-web/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './Flogination/flogination-web/components/**/*.{js,ts,jsx,tsx,mdx}',
    './Flogination/flogination-web/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // ── Light Theme Design System Colors ─────────────────────────
      colors: {
        'background':                 '#f0f2f7',
        'surface':                    '#fcf8ff',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#f5f2ff',
        'surface-container':          '#efecff',
        'surface-container-high':     '#e8e5ff',
        'surface-container-highest':  '#e2e0fc',
        'primary':                    '#5341cd',
        'primary-container':          '#6c5ce7',
        'on-primary':                 '#ffffff',
        'on-primary-container':       '#faf6ff',
        'primary-fixed':              '#e4dfff',
        'on-surface':                 '#1a1a2e',
        'on-surface-variant':         '#474554',
        'outline':                    '#787586',
        'outline-variant':            '#c8c4d7',
        'error':                      '#ba1a1a',
        'secondary':                  '#006b55',
        'secondary-container':        '#6dfad2',
        'tertiary':                   '#755300',
        'inverse-surface':            '#2f2e43',
      },

      // ── Spacing ───────────────────────────────────────────────────
      spacing: {
        // New design system tokens
        'sidebar-width':     '240px',
        'sidebar-collapsed': '52px',
        'gutter':            '24px',
        'container-margin':  '32px',
        'space-xl':          '32px',
        'space-lg':          '24px',
        'space-md':          '16px',
        'space-sm':          '8px',
        'space-xs':          '4px',
        // Legacy tokens preserved for backward compatibility
        'header_height':     '48px',
        'container_padding': '12px',
        // Sidebar legacy tokens (used in page.tsx and Sidebar.tsx)
        'sidebar_expanded':  '240px',
        'sidebar_collapsed': '52px',
        // Cell padding legacy token (used in nav buttons)
        'cell_padding_v':    '4px',
      },

      // ── Border Radius ─────────────────────────────────────────────
      borderRadius: {
        // New design system tokens
        'card':   '12px',
        'button': '8px',
        'badge':  '9999px',
        // Legacy tokens preserved for backward compatibility
        DEFAULT:  '0.125rem',
        lg:       '0.25rem',
        xl:       '0.5rem',
        full:     '0.75rem',
      },

      // ── Box Shadow ────────────────────────────────────────────────
      boxShadow: {
        'card':     '0 2px 8px rgba(0,0,0,0.06)',
        'elevated': '0 1px 3px rgba(0,0,0,0.02)',
        'sm':       '0 1px 2px rgba(0,0,0,0.05)',
        'md':       '0 4px 16px rgba(0,0,0,0.08)',
      },

      // ── Typography — Font Family ──────────────────────────────────
      fontFamily: {
        // New design system tokens
        'sans': ['Inter', 'sans-serif'],
        'mono': ['"JetBrains Mono"', 'monospace'],
        // Legacy tokens preserved for backward compatibility
        'body-md':     ['Inter', 'sans-serif'],
        'body-sm':     ['Inter', 'sans-serif'],
        'headline-sm': ['Inter', 'sans-serif'],
        'label-caps':  ['Inter', 'sans-serif'],
        'data-mono':   ['"JetBrains Mono"', 'monospace'],
      },

      // ── Typography — Font Size ────────────────────────────────────
      fontSize: {
        // New design system tokens
        'display':     ['32px', { fontWeight: '600', letterSpacing: '-0.02em' }],
        'headline-lg': ['24px', { fontWeight: '600', letterSpacing: '-0.015em' }],
        'headline-md': ['20px', { fontWeight: '600', letterSpacing: '-0.01em' }],
        'body-lg':     ['16px', { fontWeight: '400' }],
        'body-md':     ['14px', { fontWeight: '400' }],
        'label-md':    ['13px', { fontWeight: '500', letterSpacing: '0.01em' }],
        'label-sm':    ['12px', { fontWeight: '500', letterSpacing: '0.02em' }],
        'mono':        ['13px', { fontWeight: '400' }],
        // Legacy tokens preserved for backward compatibility
        'data-mono':   ['12px', { lineHeight: '16px', letterSpacing: '-0.02em', fontWeight: '400' }],
        'body-sm':     ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'headline-sm': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'label-caps':  ['10px', { lineHeight: '12px', letterSpacing: '0.05em', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};
