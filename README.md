bsslice
=======

Slice a Beat Saber beatmap

Usage
-----

Slice the Hard difficulty of My Song starting at beat 50

    bsslice.exe -i "[BeatSaber]\CustomSongs\My Song\Hard.json" -s 50


The sliced song will be located at `[BeatSaber]\CustomSongs\(sliced) My Song\Hard.json`

Slice starting at beat 50 and ending at beat 100

    bsslice.exe -i "[BeatSaber]\CustomSongs\My Song\Hard.json" -s 50 -e 100

Loop 4 times between beat 50 and beat 100

    bsslice.exe -i "[BeatSaber]\CustomSongs\My Song\Hard.json" -s 50 -e 100 -r 4


Loop 4 times between beat 50 and beat 100, adding 8 empty beats before each loop (default 4)

    bsslice.exe -i "[BeatSaber]\CustomSongs\My Song\Hard.json" -s 50 -e 100 -r 4 --silence 8

Auto reload
-----------

While bsslice is running, any changes made to the source beatmap will be automatically
reported on the slice.

The sliced song is removed automatically when stopping bsslice (CTRL-C).
