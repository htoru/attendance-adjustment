'use strict';
const express = require('express');
const router = express.Router();
const authenticationEnsurer = require('./authentication-ensurer');
const uuid = require('uuid');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const User = require('../models/user');
const Availability = require('../models/availability');
const Comment = require('../models/comment');
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

router.get('/new', authenticationEnsurer, csrfProtection, (req, res, next) => {
  res.render('new', { user: req.user, csrfToken: req.csrfToken() });
});

//新しいページを作るapi
router.post('/', authenticationEnsurer, csrfProtection, (req, res, next) => {
  const scheduleId = uuid.v4();
  const updatedAt = new Date();
  Schedule.create({
    scheduleId: scheduleId,
    scheduleName: req.body.scheduleName.slice(0, 255) || '（名称未設定）',
    memo: req.body.memo,
    createdBy: req.user.id,
    updatedAt: updatedAt
  }).then((schedule) => {
    createCandidatesAndRedirect(parseCandidateNames(req), scheduleId, res);
  });
});


//予定詳細ページにアクセスしたとき
router.get('/:scheduleId', authenticationEnsurer, (req, res, next) => {
  Schedule.findOne({
    include: [
      {
        model: User,
        attributes: ['userId', 'username']
      }],
    where: {
      scheduleId: req.params.scheduleId
    },
    order: [['"updatedAt"', 'DESC']]
  }).then((schedule) => {
    if (schedule) {
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      }).then((candidates) => {
        // データベースからその予定の全ての出欠を取得する
        Availability.findAll({  //出欠データを全て取得
          include: [  //Sequelizeの書き方で実際のSQLではJOIN
            {
              model: User, //UserとJOIN
              attributes: ['userId', 'username']
            }
          ],
          where: { scheduleId: schedule.scheduleId },
          order: [[User, 'username', 'ASC'], ['"candidateId"', 'ASC']]
        }).then((availabilities) => {  //availabilities→全ての出欠の情報が入る
          // 出欠 MapMap(キー:ユーザー ID, 値:出欠Map(キー:候補 ID, 値:出欠)) を作成する
          const availabilityMapMap = new Map(); // key: userId, value: Map(key: candidateId, availability)
          availabilities.forEach((a) => { //availabilitiesの回数ループ aはavailability
            //mapとはavailabilityMapの事。availabilityMapMapに個別の候補a.user.userIdをgetして、availabilityMapを取ってくる
            const map = availabilityMapMap.get(a.user.userId) || new Map();

            //mapに(availabilityMapの事)値をセット 候補IDとavailabilityの状態(出席か欠席か) ユーザーごとに作る
            map.set(a.candidateId, a.availability); 

            //MapMapにセットし直す。誰か(userId)のmap、つまりmap.set(a.candidateId, a.availability); の中身が入る
            availabilityMapMap.set(a.user.userId, map);
          });

          // 閲覧ユーザーと出欠に紐づくユーザーからユーザー Map (キー:ユーザー ID, 値:ユーザー) を作る
          const userMap = new Map(); // key: userId, value: User(ユーザー名)
          userMap.set(parseInt(req.user.id), { //キー:user.id 値:連想配列
            isSelf: true,//isSelfとは自分かどうかの判断をする
            userId: parseInt(req.user.id),
            username: req.user.username
          });
          availabilities.forEach((a) => {
            userMap.set(a.user.userId, {
              //ログインしているユーザーとデータベース上のユーザーとを比較して合っていたらisSelfがtrue
              isSelf: parseInt(req.user.id) === a.user.userId, 
              userId: a.user.userId,
              username: a.user.username
            });
          });

          /*
          全ユーザー、全候補で二重ループしてそれぞれの出欠の値が無い場合には「欠席」を設定する
          Array.fromは連想配列(userMap)を普通の配列に変換する
          連想配列には.mapは使えないが普通の配列には使える
          keyValueの配列の内Valueだけを抜き取っている。
          const usersの中身になるのは↑のuserMapの{}内のデータisSelf,userId,username
          */
          const users = Array.from(userMap).map((keyValue) => keyValue[1]);
          users.forEach((u) => {
            candidates.forEach((c) => { //candidatesは候補
              const map = availabilityMapMap.get(u.userId) || new Map();
              const a = map.get(c.candidateId) || 0; // デフォルト値は0を利用
              map.set(c.candidateId, a);
              //userId毎に候補毎の出欠情報をセット
              availabilityMapMap.set(u.userId, map);
            });
          });

          //コメント取得
          Comment.findAll({
            where: { scheduleId: schedule.scheduleId }
          }).then((comments) => {
            const commentMap = new Map(); //key: userId, value: comment
            comments.forEach((comment) => {
              commentMap.set(comment.userId, comment.comment);
            });
            res.render('schedule', {
              user: req.user,
              schedule: schedule,
              candidates: candidates,
              users: users,
              availabilityMapMap: availabilityMapMap,
              commentMap: commentMap
            });
          });
        });
      });
    } else {
      const err = new Error('指定された予定は見つかりません');
      err.status = 404;
      next(err);
    }
  });
});
 
//予定編集をするための実装
router.get('/:scheduleId/edit', authenticationEnsurer, csrfProtection, (req, res, next) => {
  Schedule.findOne({//予定のデータを取ってくる
    where: {
      scheduleId: req.params.scheduleId
    }
  }).then((schedule) => {
    if (isMine(req, schedule)) { // 作成者のみが編集フォームを開ける
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      }).then((candidates) => {
        res.render('edit', {
          user: req.user, //ユーザー毎の
          schedule: schedule, //予定の状態
          candidates: candidates, //候補日の状態
          csrfToken: req.csrfToken()
        });
      });
    } else {
      const err = new Error('指定された予定がない、または、予定する権限がありません');
      err.status = 404;
      next(err);
    }
  });
});


//予定がある事を確認し、かつ、作成者と現在利用している人が合っているかの真偽値を返す
function isMine(req, schedule) {
  return schedule && parseInt(schedule.createdBy) === parseInt(req.user.id);
}

//編集ページのapi
router.post('/:scheduleId', authenticationEnsurer, csrfProtection, (req, res, next) => {
  Schedule.findOne({
    where: {
      scheduleId: req.params.scheduleId //予定 ID で予定を取得
    }
  }).then((schedule) => {
    //リクエストの送信者が作成者であるかをチェックし、 edit=1 のクエリがあるときのみ更新
    if (schedule && isMine(req, schedule)) {
      if (parseInt(req.query.edit) === 1) {
        const updatedAt = new Date();
        schedule.update({
          scheduleId: schedule.scheduleId,
          scheduleName: req.body.scheduleName.slice(0, 255) || '（名称未設定）',
          memo: req.body.memo,
          createdBy: req.user.id,
          updatedAt: updatedAt
        }).then((schedule) => {
          // 追加されているかチェック
          const candidateNames = parseCandidateNames(req);
          if (candidateNames) {
            createCandidatesAndRedirect(candidateNames, schedule.scheduleId, res);
          } else {
            res.redirect('/schedules/' + schedule.scheduleId);
          }
        });
      } else if (parseInt(req.query.delete) === 1) {
        deleteScheduleAggregate(req.params.scheduleId, () => {
          res.redirect('/');
       });
      } else {
        //edit=1 以外のクエリが渡された際の処理
        const err = new Error('不正なリクエストです');
        err.status = 400;
        next(err);
      }
    } else {
      //予定が見つからない場合や自分自身の予定ではない場合の処理
      const err = new Error('指定された予定がない、または、編集する権限がありません');
      err.status = 404;
      next(err);
    }
  });
});

//候補日程の配列、予定 ID 、レスポンスを受け取り、 候補の作成とリダイレクトを行う
function createCandidatesAndRedirect(candidateNames, scheduleId, res) {
  const candidates = candidateNames.map((c) => { 
    return {
      candidateName: c,
      scheduleId: scheduleId
    };
  });
  Candidate.bulkCreate(candidates).then(() => {
    res.redirect('/schedules/' + scheduleId);
  });
}

//リクエストから予定名の配列をパースする処理
function parseCandidateNames(req) {
  return req.body.candidates
  .trim()
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s !== "");
}

function deleteScheduleAggregate(scheduleId, done, err) {
  const promiseCommentDestroy = Comment.findAll({
    where: { scheduleId: scheduleId }
  }).then((comments) => {
    return Promise.all(comments.map((c) => { return c.destroy(); }));
  });

  Availability.findAll({
    where: { scheduleId: scheduleId }
  }).then((availabilities) => {
    const promises = availabilities.map((a) => { return a.destroy(); });
    return Promise.all(promises);
  }).then(() => {
    return Candidate.findAll({
      where: { scheduleId: scheduleId }
    });
  }).then((candidates) => {
    const promises = candidates.map((c) => { return c.destroy(); });
    promises.push(promiseCommentDestroy);
    return Promise.all(promises);
  }).then(() => {
    return Schedule.findByPk(scheduleId).then((s) => { return s.destroy(); });
  }).then(() => {
    if (err) return done(err);
    done();
  });
}

router.deleteScheduleAggregate = deleteScheduleAggregate;

module.exports = router;
