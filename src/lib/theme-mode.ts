// One list, two readers. The ThemeSwitcher decides which next-themes mode a
// base theme belongs to, and the Android status bar controller picks its icon
// colour from the same answer — two hand-kept copies of this set would drift
// exactly the way BottomNav and IN_BOTTOM_NAV once did. "light" is the
// attribute-less light theme; anything absent here is dark.
export const LIGHT_THEMES = new Set([
  "light", "sunny", "blossom", "sage", "paper", "lilac", "sand", "mint",
])
