'use strict';
import $ from 'jquery';
const global = Function('return this;')();
global.jQuery = $;
import bootstrap from 'bootstrap';

/**
 * 引数 i は順番(Index)、 引数 e は HTML 要素(Element)が渡される
 * .availability-toggle-buttonでschedule.pugのbutton要素を全て取ってくる
 */
$('.availability-toggle-button').each((i, e) => {
  const button = $(e);
  button.click(() => {
    const scheduleId = button.data('schedule-id');//予定 ID
    const userId = button.data('user-id');//ユーザー ID
    const candidateId = button.data('candidate-id');//候補 ID
    const availability = parseInt(button.data('availability'));//出席
    const nextAvailability = (availability + 1) % 3;
    /**
     * 出欠更新の Web API の呼び出しと、実行結果を受け取って
     * button 要素の、 data-* 属性を更新し、ボタンのラベルを更新
     */
    $.post(`/schedules/${scheduleId}/users/${userId}/candidates/${candidateId}`,
      { availability: nextAvailability },
      (data) => {
        button.data('availability', data.availability);
        const availabilityLabels = ['欠', '？', '出'];
        button.text(availabilityLabels[data.availability]);

        const buttonStyles = ['btn-danger', 'btn-secondary', 'btn-success'];
        button.removeClass('btn-danger btn-secondary btn-success');
        button.addClass(buttonStyles[data.availability]);
      });
  });
});

const buttonSelfComment = $('#self-comment-button');
buttonSelfComment.click(() => {
  const scheduleId = buttonSelfComment.data('schedule-id');
  const userId = buttonSelfComment.data('user-id');
  const comment = prompt('コメントを255文字以内で入力してください。');
  if (comment) {
    $.post(`/schedules/${scheduleId}/users/${userId}/comments`,
      { comment: comment },
      (data) => {
        $('#self-comment').text(data.comment);
      });
  }
});
