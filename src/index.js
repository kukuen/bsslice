import ffmpeg  from 'fluent-ffmpeg'
import path from 'path'
import child_process from 'child_process'
import _ from 'lodash'
import fs from 'fs-extra'

const ROOT = 'E:\\SteamLibrary\\steamapps\\common\\Beat Saber\\CustomSongs'


async function slice({songName, difficulty, startBeat, endBeat = null, repeatCount = 1, silentBeats = 2}) {
    let srcDir = path.join(ROOT, songName);
    let destDir = path.join(ROOT, '__' + songName + ' (sliced)');
    let info = JSON.parse(await fs.readFile(path.join(srcDir, 'info.json'), 'utf8'))

    let newInfo = {
        ...info,
        songName: '(sliced) ' + info.songName,
        difficultyLevels: info.difficultyLevels.filter(d => d.difficulty === difficulty)
    }

    if (newInfo.difficultyLevels.length === 0) throw new Error('No difficulty ' + difficulty + ' found')

    let difficultyLevel = newInfo.difficultyLevels[0]

    let beatmap = JSON.parse(await fs.readFile(path.join(srcDir, difficultyLevel.jsonPath), 'utf8'))

    let bpm = beatmap._beatsPerMinute;

    let silenceDuration = silentBeats * 60 / bpm
    let startTime = startBeat * 60 / bpm
    let endTime = endBeat != null ? endBeat * 60 / bpm : null

    let baseNewBeatmap = {
        ...beatmap,
        _obstacles: beatmap._obstacles
            .filter(filterByTime(startBeat, endBeat))
            .map(addTime(-(startBeat - silentBeats))),
        _events: beatmap._events
            .filter(filterByTime(startBeat, endBeat))
            .map(addTime(-(startBeat - silentBeats))),
        _notes: beatmap._notes
            .filter(filterByTime(startBeat, endBeat))
            .map(addTime(-(startBeat - silentBeats)))
        ,
    }

    let parts = [
        {
            duration: silenceDuration
        },
        {
            source: path.join(srcDir, difficultyLevel.audioPath),
            startTime: startTime,
            duration: endTime ? endTime - startTime : null
        }];


    let newBeatmap = baseNewBeatmap;

    if (repeatCount > 1) {
        let loopDuration = silentBeats + endBeat - startBeat;

        for (var i = 1; i < repeatCount; i++) {
            newBeatmap._obstacles = [
                ...newBeatmap._obstacles,
                ...baseNewBeatmap._obstacles.map(addTime(loopDuration * i))
            ]
            newBeatmap._events = [
                ...newBeatmap._events,
                ...baseNewBeatmap._events.map(addTime(loopDuration * i))
            ]
            newBeatmap._notes = [
                ...newBeatmap._notes,
                ...baseNewBeatmap._notes.map(addTime(loopDuration * i))
            ]
            parts = [
                ...parts,
                {
                    duration: silenceDuration
                },
                {
                    source: path.join(srcDir, difficultyLevel.audioPath),
                    startTime: startTime,
                    duration: endTime ? endTime - startTime : null
                }
            ]
        }
    }

    await fs.ensureDir(destDir)
    await fs.writeFile(path.join(destDir, difficultyLevel.jsonPath), JSON.stringify(newBeatmap))
    await fs.writeFile(path.join(destDir, 'info.json'), JSON.stringify(newInfo))
    await concat({
        parts: parts,
        output: path.join(destDir, difficultyLevel.audioPath)
    })
}

function addTime(delta) {
    return e => ({...e, _time: e._time + delta})
}

function filterByTime(startTime, endTime) {
    return e => e._time >= startTime && (endTime == null || e._time < endTime)
}

slice({songName: 'Invader Invader', difficulty: 'Expert', startBeat: 197, endBeat: 229, repeatCount: 1})


async function concat({parts, output}) {
    return new Promise((resolve, reject) => {
        let filters = []
        let filtersParts = []
        let sources = _.chain(parts)
            .flatMap((p, i) => {
                if (p.source == null) {
                    filtersParts.push('[' + i + ']')
                    return [
                        '-f', 'lavfi',
                        '-t', toFfmpegTime(p.duration),
                        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44000'
                    ]
                } else {
                    filters.push('[' + i + ']afade=t=in:st=0:d=1[a' + i + ']')
                    filtersParts.push('[a' + i + ']')
                    let res = [];

                    if (p.startTime) res = [...res, '-ss', toFfmpegTime(p.startTime)]
                    if (p.duration) res = [...res, '-t', toFfmpegTime(p.duration)]

                    res = [...res, '-i', p.source]

                    return res
                }
            })
            .value();

        console.log(sources)
        console.log(filters)
        console.log(filtersParts)

        let filtersStr = filters.join('; ')+';'
        let filtersPartsStr = filtersParts.join(' ')

        let args = [
            ...sources,
            '-filter_complex', filtersStr + ' ' + filtersPartsStr + ' concat=n=' + parts.length + ':v=0:a=1 ',
            '-y',
            output];

        let concat = child_process.spawn(path.join(__dirname, '../ffmpeg/ffmpeg.exe'), args, {stdio: 'inherit'});

        concat.on('close', code => {
            if (code === 0) resolve()
            else reject(new Error('ffmpeg error code ' + code));
        })
    })
}

function toFfmpegTime(secs) {
    let ms = Math.floor((secs * 1000) % 1000)
    let s = Math.floor(secs % 60)
    let m = Math.floor((secs / 60) % 60)

    return m.toString().padStart(2, '0')
        + ':' + s.toString().padStart(2, '0')
        + '.' + ms.toString().padStart(3, '0')
}

function getFormat(file) {

    return new Promise((resolve, reject) => {
        let decoder = child_process.spawn(path.join(__dirname, '../ffmpeg/ffprobe.exe'), [
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            file
        ]);

        let str = '';

        decoder.stdout.on('data', d => str += d);
        decoder.on('close', code => {
            if (code === 0)resolve(JSON.parse(str))
            else reject(new Error('ffprobe error code ' + code));
        })
    })

}
