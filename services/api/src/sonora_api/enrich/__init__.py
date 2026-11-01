"""Metadata from open databases: LRCLIB (lyrics), MusicBrainz + Cover Art Archive (covers),
Wikidata / Wikimedia Commons / Wikipedia (artist photos and biographies).

Identification is strict on purpose — a wrong artist photo or someone else's lyrics is worse
than none: names must match after normalisation, durations within a couple of seconds, and the
match must be unambiguous. Every lookup is best-effort and never raises to the caller.
"""
