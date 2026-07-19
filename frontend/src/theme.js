// Shared design tokens for the NGO dashboard. Matches the partner's dark theme.
export const theme = {
  bg: '#0d1117',
  bgElevated: '#0f141b',
  card: '#161b22',
  cardHover: '#1c2230',
  border: '#30363d',
  accent: '#00d4aa',
  accentDim: 'rgba(0, 212, 170, 0.12)',
  accentBorder: 'rgba(0, 212, 170, 0.35)',
  textPrimary: '#e6edf3',
  textSecondary: '#8b949e',
  success: '#3fb950',
  error: '#f85149',
  warning: '#d29922',
}

// Small helper to build consistent card containers.
export const card = {
  background: theme.card,
  border: `1px solid ${theme.border}`,
  borderRadius: 14,
}
