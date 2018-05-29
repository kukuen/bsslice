import path from 'path';
import child_process from 'child_process';
import _ from 'lodash';
import fs from 'fs-extra';
import yargs from 'yargs';
import moment from 'moment'

import TaskDelay from './task-delay'

const FFMPEG_PATH = path.join(process.cwd(), 'ffmpeg/ffmpeg.exe');
const WATCH_UPDATE_DELAY = 100;

let argv = yargs
    .option('i', {
        alias: 'input',
        demandOption: true,
        describe: 'path to the difficulty .json file',
        type: 'string'
    })
    .option('s', {
        alias: 'start',
        demandOption: true,
        describe: 'beat to start the slice at',
        type: 'number'
    })
    .option('e', {
        alias: 'end',
        describe: 'beat to end the slice at',
        default: null,
        type: 'number'
    })
    .option('r', {
        alias: 'repeat',
        describe: 'repeat the slice [n] times (require --end option)',
        default: 1,
        type: 'number'
    })
    .option('silence', {
        describe: 'add [n] empty beats before each slice',
        default: 4,
        type: 'number'
    })
    .argv;

watchSlice({
    songFile: argv.input,
    startBeat: argv.start,
    endBeat: argv.end,
    repeatCount: argv.repeat,
    silentBeats: argv.silence
})
    .catch(err => console.error(err));

async function watchSlice({songFile, startBeat, endBeat , repeatCount , silentBeats }) {
    let dir = path.dirname(songFile);
    let taskDelay = new TaskDelay();
    fs.watch(dir, (eventType, filename) => {
        taskDelay.delay(async() => {
            log('slicing beatmap only');
            await slice({songFile, startBeat, endBeat, repeatCount, silentBeats, sliceAudio: false});
            log('done');
            log();
        }, WATCH_UPDATE_DELAY)
    });
    taskDelay.delay(async() => {
        log('slicing beatmap + sound');
        await slice({songFile, startBeat, endBeat, repeatCount, silentBeats, sliceAudio: true});
        log('done');
        log();
    }, WATCH_UPDATE_DELAY)
}

async function slice({songFile, startBeat, endBeat = null, repeatCount = 1, silentBeats = 4, sliceAudio = true}) {
    let difficulty = path.basename(songFile, '.json');
    let srcDir = path.dirname(songFile);
    let songName = path.basename(srcDir)
    let destDir = path.join(path.dirname(srcDir), '(sliced) ' + songName);

    let info = JSON.parse(await fs.readFile(path.join(srcDir, 'info.json'), 'utf8'));

    let newInfo = {
        ...info,
        songName: '(sliced) ' + info.songName,
        difficultyLevels: info.difficultyLevels.filter(d => d.difficulty === difficulty)
    };

    if (newInfo.difficultyLevels.length === 0) throw new Error('No difficulty ' + difficulty + ' found');

    let difficultyLevel = newInfo.difficultyLevels[0];

    let beatmap = JSON.parse(await fs.readFile(songFile, 'utf8'));

    let bpm = beatmap._beatsPerMinute;
    let offsetDuration = (difficultyLevel.offset / 1000) / (60 / bpm)// in beats

    let startBeatWithOffset = startBeat + offsetDuration;
    let endBeatWithOffset = endBeat != null ? endBeat + offsetDuration : null;

    let silenceDuration = silentBeats * 60 / bpm;
    let startTime = startBeat * 60 / bpm;
    let endTime = endBeat != null ? endBeat * 60 / bpm : null;

    let baseEvents = _.chain(beatmap._events)
        .filter(filterByTime(0, startBeatWithOffset))
        .reduce((initEvents, e) => ({
            ...initEvents,
            [e._type]: e._value
        }), {})
        .toPairs()
        .map(([type, value]) => ({_time: 0, _type: parseInt(type), _value: value}))
        .value();

    let baseNewBeatmap = {
        ...beatmap,
        _obstacles: beatmap._obstacles
            .filter(filterByTime(startBeatWithOffset, endBeatWithOffset))
            .map(cropObstacle(endBeatWithOffset))
            .map(addTime(-(startBeat - silentBeats))),
        _events: [
            ...baseEvents.map(addTime(silentBeats / 2 + offsetDuration)),
            ...beatmap._events
                .filter(filterByTime(startBeatWithOffset, endBeatWithOffset))
                .map(addTime(-(startBeat - silentBeats)))
        ],
        _notes: beatmap._notes
            .filter(filterByTime(startBeatWithOffset, endBeatWithOffset))
            .map(addTime(-(startBeat - silentBeats)))

    };

    let parts = [
        {
            duration: silenceDuration / 2
        },
        {
            source: path.join(srcDir, difficultyLevel.audioPath),
            startTime: startTime - silenceDuration / 2,
            fadeIn: silenceDuration / 2,
            fadeOut: silenceDuration / 2,
            duration: endTime ? endTime - startTime + silenceDuration : null
        }];

    let newBeatmap = {...baseNewBeatmap};

    if (repeatCount > 1) {
        let loopDuration = silentBeats + endBeat - startBeat;

        for (let i = 1; i < repeatCount; i++) {
            newBeatmap._obstacles = [
                ...newBeatmap._obstacles,
                ...baseNewBeatmap._obstacles.map(addTime(loopDuration * i))
            ];
            newBeatmap._events = [
                ...newBeatmap._events,
                ...baseNewBeatmap._events.map(addTime(loopDuration * i))
            ];
            newBeatmap._notes = [
                ...newBeatmap._notes,
                ...baseNewBeatmap._notes.map(addTime(loopDuration * i))
            ];
            parts = [
                ...parts,
                {
                    source: path.join(srcDir, difficultyLevel.audioPath),
                    startTime: startTime - silenceDuration / 2,
                    fadeIn: silenceDuration / 2,
                    fadeOut: silenceDuration / 2,
                    duration: endTime ? endTime - startTime + silenceDuration : null
                }
            ];
        }
    }

    await fs.ensureDir(destDir);
    await fs.writeFile(path.join(destDir, difficultyLevel.jsonPath), JSON.stringify(newBeatmap));
    await fs.writeFile(path.join(destDir, 'info.json'), JSON.stringify(newInfo));
    if (sliceAudio) {
        await concat({
            parts: parts,
            output: path.join(destDir, difficultyLevel.audioPath)
        });
    }
}

function addTime(delta) {
    return e => ({...e, _time: e._time + delta});
}

function filterByTime(startTime, endTime) {
    return e => e._time >= startTime && (endTime == null || e._time < endTime);
}

function cropObstacle(endTime) {
    return e => ({
        ...e,
        _duration: Math.min(e._duration, endTime - e._time)
    })
}

async function concat({parts, output}) {
    return new Promise((resolve, reject) => {
        let sources = _.chain(parts)
            .map(part => {
                if (part.source == null) {
                    if (part.duration > 0) {
                        return {
                            input: [
                                '-f', 'lavfi',
                                '-t', toFfmpegTime(part.duration),
                                '-i', 'anullsrc=channel_layout=stereo:sample_rate=44000'
                            ],
                            filters: []
                        };
                    }
                    else {
                        return null;
                    }
                }
                else {
                    let input = [];
                    let filters = [];

                    if (part.fadeIn) filters.push('afade=t=in:st=0:d=' + toFfmpegTime(part.fadeIn));
                    if (part.fadeOut && part.duration) filters.push('afade=t=out:st=' + toFfmpegTime(part.duration - part.fadeOut) + ':d=' + toFfmpegTime(part.fadeOut));

                    if (part.startTime) input.push('-ss', toFfmpegTime(part.startTime));
                    if (part.duration) input.push('-t', toFfmpegTime(part.duration));

                    input.push('-i', part.source);

                    return {
                        input: input,
                        filters: filters
                    };
                }
            })
            .filter(e => e != null)
            .value();

        let filters = sources
            .map((s, i) => {
                if (s.filters.length === 0) return null;
                return '[' + i + ']' + s.filters.join(',') + '[a' + i + ']';
            })
            .filter(s => s != null);

        let concatSources = sources.map((s, i) => s.filters.length === 0 ? '[' + i + ']' : '[a' + i + ']').join('');
        let concatFilter = concatSources + 'concat=n=' + sources.length + ':v=0:a=1';

        let inputs = _.flatMap(sources, s => s.input);

        filters.push(concatFilter);

        let args = [
            ...inputs,
            '-filter_complex', filters.join(';'),
            '-y',
            output];

        let concat = child_process.spawn(FFMPEG_PATH, args);

        concat.on('close', code => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error('ffmpeg error code ' + code));
            }
        });
    });
}

function toFfmpegTime(secs) {
    let ms = Math.floor((secs * 1000) % 1000);
    let s = Math.floor(secs);

    return s.toString().padStart(2, '0')
        + '.' + ms.toString().padStart(3, '0');
}

function log(...args) {
    console.log(`[${moment().format('HH:mm:ss')}]`, ...args)
}