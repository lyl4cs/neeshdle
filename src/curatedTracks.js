// Pool for the public (no-login) mode. Apple track ids, verified by hand —
// looked up exactly via lookupTracks, never searched by name, so there's no
// wrong-song-matched risk on the answer itself like there would be with a
// fuzzy title/artist search.
//
// IMPORTANT: the free itunes.apple.com/search endpoint (used for in-game
// guess autocomplete) is a different, unpersonalized index from Apple
// Music's own in-app search — very new releases (roughly the last 1-2
// months) routinely don't show up in it at all yet, even though lookup-by-id
// and preview playback work fine for them. A track that isn't searchable
// can never be guessed correctly. Before adding a track here, verify it
// ranks near the top of a bare-title search (no artist) via
// itunes.apple.com/search?media=music&entity=song&term=<title> — not just
// that lookupTracks can find it by id. Well-established, already-charted
// songs are safe; brand-new singles are risky until they propagate.
export const CURATED_TRACK_IDS = [
  '1488408568', // Blinding Lights - The Weeknd
  '1193701392', // Shape of You - Ed Sheeran
  '1615585008', // As It Was - Harry Styles
  '1538003843', // Levitating - Dua Lipa
  '1674691586', // Flowers - Miley Cyrus
  '1450695739', // bad guy - Billie Eilish
  '1544491233', // Rolling in the Deep - Adele
  '1544491998', // Someone Like You - Adele
  '1468166468', // Old Town Road - Lil Nas X
  '1485802967', // Watermelon Sugar - Harry Styles
  '1649434293', // Anti-Hero - Taylor Swift
  '1468058171', // Cruel Summer - Taylor Swift
  '1556170101', // Peaches - Justin Bieber
  '1560735480', // drivers license - Olivia Rodrigo
  '1582277652', // good 4 u - Olivia Rodrigo
]
