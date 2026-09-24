# Reference coins

Drop photos of FINISHED coins into the `coins/` folder (JPG, PNG, or WEBP). Only `coins/` is used; anything else in this folder is ignored. Do not put logos or
artwork in this folder; the AI will mistake them for the customer's design. The app sends a few of these
along with each customer image so the AI matches our coin style.

Tips:
- Straight-on, well-lit, one coin per photo, no hands or packaging.
- File names can be anything.
- Optional: inside `coins/`, sort by finish into subfolders named after the finish keys (shiny-gold, antique-gold,
  satin-gold, shiny-silver, antique-silver, satin-silver, shiny-copper, antique-copper, antique-brass,
  shiny-nickel, satin-nickel, black-nickel). Photos in a matching subfolder are preferred;
  photos directly in `coins/` are used for any finish.
- Coins that are NOT round (shield, star, state outline, cut to the artwork...) go in `coins/odd-shaped/`. They are
  shown only when the customer picks "Odd shaped", and never for a round coin. Round coins with a cut-out middle are
  still round: they stay in `coins/`. Finish subfolders work inside `odd-shaped/` too.
- Never save builder downloads here: a watermarked preview in `coins/` would teach the AI to draw watermarks.
