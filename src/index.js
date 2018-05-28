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
    let offset = info.offset;

    let silenceDuration = silentBeats * 60 / bpm
    let startTime = startBeat * 60 / bpm
    let endTime = endBeat != null ? endBeat * 60 / bpm : null

    console.log(startTime, endTime)

    let newBeatmap = {
        ...beatmap,
        _obstacles: beatmap._obstacles
            .filter(filterByTime(startBeat, endBeat))
            .map(reduceTime(startBeat - silentBeats))
        ,
        _events: beatmap._events
            .filter(filterByTime(startBeat, endBeat))
            .map(reduceTime(startBeat - silentBeats))
        ,
        _notes: beatmap._notes
            .filter(filterByTime(startBeat, endBeat))
            .map(reduceTime(startBeat - silentBeats))
        ,
    }

    //console.log(slicedInfo)
    //console.log(beatmap)

    await fs.ensureDir(destDir)
    await fs.writeFile(path.join(destDir, difficultyLevel.jsonPath), JSON.stringify(newBeatmap))
    await fs.writeFile(path.join(destDir, 'info.json'), JSON.stringify(newInfo))
    await concat({
        parts: [
            {
                duration: silenceDuration
            },
            {
                source: path.join(srcDir, difficultyLevel.audioPath),
                startTime: startTime,
                duration: endTime ? endTime - startTime : null
            }],
        output: path.join(destDir, difficultyLevel.audioPath)
    })
}

function reduceTime(delta) {
    return e => ({...e, _time: e._time - delta})
}

function filterByTime(startTime, endTime) {
    return e => e._time >= startTime && (endTime == null || e._time <= endTime)
}

slice({songName: 'Invader Invader', difficulty: 'Expert', startBeat: 150})
//
//concat({
//    parts: [
//        {duration: 2},
//        {
//            source: path.join(__dirname, '../song.ogg'),
//            startTime: 30,
//            duration: 0.1
//        }
//    ],
//    output: path.join(__dirname, '../song2.ogg')
//});


async function concat({parts, output}) {
    return new Promise((resolve, reject) => {
        let sources = _.chain(parts)
            .flatMap(p => {
                if (p.source == null) {
                    return [
                        '-f', 'lavfi',
                        '-t', toFfmpegTime(p.duration),
                        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44000'
                    ]
                } else {
                    let res = [];
                    if (p.startTime) res = [...res, '-ss', toFfmpegTime(p.startTime)]
                    if (p.duration) res = [...res, '-t', toFfmpegTime(p.duration)]
                    return [...res, '-i', p.source]
                }
            })
            .value();

        console.log(sources)

        let filter = _.range(parts.length).map(i => '[' + i + ']').join(' ')

        let args = [
            ...sources,
            '-filter_complex', filter + ' concat=n=' + parts.length + ':v=0:a=1 ',
            '-y',
            output];

        let concat = child_process.spawn(path.join(__dirname, '../ffmpeg/ffmpeg.exe'), args);

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
