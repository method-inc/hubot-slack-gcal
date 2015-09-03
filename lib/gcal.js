var _ = require('underscore'),
    Util = require("util"),
    helpers = require('./helpers'),
    googleapis = require('googleapis'),
    uuid = require('node-uuid'),
    moment = require("moment");
require('twix');

var gcal = {

  getPrimaryCalendar: function(oauth, cb) {
    googleapis
      .calendar('v3')
      .calendarList.list({minAccessRole: 'owner', auth: oauth}, function(err, data) {
        if(err) return cb(err);
        cb(undefined, _.find(data.items, function(c) {
          return c.primary;
        }));
      });
  },

  rsvp: function(oauth, event, status, cb) {
    gcal.getPrimaryCalendar(oauth, function(err, calendar_o) {
      if(err || !calendar_o) return cb("Could not find your primary calendar", undefined);
      var calendar = calendar_o.id;
      googleapis.calendar('v3').events.get({ auth: oauth, alwaysIncludeEmail: true, calendarId: calendar, eventId: event }, function(err, event) {
        if(err) return cb('Error getting event: ' + err, undefined);
        var attendees = event.attendees;
        var me = _.find(attendees, function(a) { return a.self });
        if(!me) return cb("You are not invited to " + event.summary, undefined);
        me.responseStatus = status;
        googleapis.calendar('v3').events.patch({ auth: oauth, calendarId: calendar, eventId: event.id, resource: { attendees: attendees } }, function(err, event) {
          if(err) return cb('Error saving status: ' + err, undefined);
          cb(undefined, event);
        });
      });
    });
  }

};

module.exports = gcal;