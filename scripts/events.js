// Description:
//   Commands for interfacing with google calendar.
//
// Commands:
//   hubot what <room>s are available - finds rooms of type <room> available for the next hour
//   hubot create an event <event> - creates an event with the given quick add text
//   hubot reserve me <room> for <event> - creates an event with the given quick add text and invites the given room
//   hubot invite <usernames> - invite the given usernames to the last event
//   hubot reply <yes|no|maybe> - reply to the last event
//   hubot find a time <when> with <people> for <event name> - find a time when everyone is available

module.exports = function(robot) {
  var _ = require('underscore'),
      helpers = require('../lib/helpers'),
      Util = require("util"),
      Fs = require("fs"),
      googleapis = require('googleapis'),
    	chrono = require('chrono-node'),
      moment = require("moment");
  require('twix');
  
  var START_OF_DAY = 9,
  		END_OF_DAY = 17;

  var groups = {};
  try {
    groups = JSON.parse(Fs.readFileSync("calendar-resources.json").toString());
  } catch(e) {
    console.warn("Could not find calendar-resources.json file");
  }
  
  function reply_with_new_event(msg, event, pretext) {
    var attachment = helpers.event_slack_attachment(event, pretext);
    robot.emit('slack.attachment', {channel: msg.message.room, attachments: [attachment]});
  }

  function getPrimaryCalendar(oauth, cb) {
    googleapis
      .calendar('v3')
      .calendarList.list({minAccessRole: 'owner', auth: oauth}, function(err, data) {

        cb(undefined, _.find(data.items, function(c) {
          return c.primary;
        }));
      });
  }

  robot.on("google:calendar:actionable_event", function(user, event) {
    user.last_event = event.id;
  });
  
  
  robot.respond(/find a time( (.+?))?( with (.+))? for (.+)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
    	console.log(msg.match);
      var event_name = msg.match[5],
					time_text = msg.match[2],
      		participant_text = msg.match[4];
      
      // get participant emails for this event
      // if a list of usernames was provided, use that
			var emails;
      if(participant_text) {
        try {
        	emails = _.pluck(helpers.get_emails_from_usernames(robot, participant_text.split(' ')), 'email');
        } catch(e) {
        	msg.reply(e);
        }
      }
      // otherwise, invite all members of the current channel
      else {
      	var channel = robot.adapter.client.getChannelGroupOrDMByName(msg.message.room);
      	if(channel && channel.members) {
      		emails = _.compact(_.map(channel.members, function(user_id) {
      			var user = robot.adapter.client.getUserByID(user_id);
      			if(!user || user.is_bot || !user.profile.email) return;
      			return user.profile.email;
      		}));
      	}
      	else {
      		return msg.send("Couldn't get participants in this channel, try specifying them in the command.");
      	}
      }
      
      // get start and end time for this request
      // if a time is specified, use that
      var start_time, end_time;
      if(time_text) {
      	var parsed_time = chrono.parse(time_text);
      	if(!parsed_time[0]) return msg.reply("Sorry, I couldn't get a time range from " + time_text);
      	var r = parsed_time[0];
				// if either start or end hour of day was implied (as opposed to explicitly stated),
				// set it to the beginning and end of work day
      	if(typeof r.start.impliedValues.hour !== 'undefined') r.start.imply('hour', START_OF_DAY);
      	if(r.end && typeof r.end.impliedValues.hour !== 'undefined') r.end.imply('hour', END_OF_DAY);
      	start_time = moment(r.start.date());
      	end_time = (!!r.end ? moment(r.end.date()) : moment(start_time).hour(END_OF_DAY));
      }
      else {
      	start_time = moment();
      	end_time = moment(start_time).hour(END_OF_DAY);
      }
			var range = start_time.twix(end_time);
      msg.reply("Here are the times " + emails.join(", ") + " are available " + range.format());
    });
  });

  robot.respond(/(which|what|are any|are there any) (.+)s (are )?(available|free|open)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
      var group_name = msg.match[2],
          group = groups[group_name],
          startTime = new Date().toISOString(),
          endTime = new Date();
      endTime.setHours(endTime.getHours()+1);
      endTime = endTime.toISOString();
      if(group) {
        var req = googleapis.calendar('v3').freebusy.query({ auth: oauth, resource: { items: _.map(_.keys(group), function(g) { return { id: g } }), timeMin: startTime, timeMax: endTime } }, function (err, availability) {
          if(err) { msg.reply("Error getting calendar availability"); return console.log(err); }
          var available = [];
          _.each(availability.calendars, function(c, id) {
            if(!c.errors && c.busy.length == 0) {
              available.push(group[id][0]);
            }
          });
          if(available.length == 0) return msg.send("There are no " + group_name + "s available in the next hour");
          msg.send("These " + group_name + "s are free for the next hour:\n" + available.join("\n"));
        });
      } else {
        msg.reply("I don't know anything about " + group_name);
      }
    });
  });

  robot.respond(/(book|reserve) (me )?(.+) for (.+)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
      getPrimaryCalendar(oauth, function(err, calendar) {
        if(err || !calendar) return msg.reply("Could not find your primary calendar");
        var room_name = msg.match[3].toLowerCase(), room;
        _.each(groups, function(group) {
          _.each(group, function(room_names, id) {
            if(_.contains(room_names, room_name)) room = id;
          });
        });
        if(!room) return msg.reply("I don't know what " + room_name + " is");
        googleapis.calendar('v3').events.quickAdd({ auth: oauth, calendarId: calendar.id, text: msg.match[4] }, function(err, event) {
          if(err || !event) { msg.reply("Error creating event"); return console.log(err); }
          googleapis.calendar('v3').events.patch({ auth: oauth, calendarId: calendar.id, eventId: event.id, resource: { attendees: [ { email: room } ] } }, function(err, event) {
            if(err || !event) return msg.reply("Error reserving room");
            reply_with_new_event(msg, event, "OK, I reserved " + room_name + " for you:");
            msg.message.user.last_event = event.id;
            msg.message.user.last_event_calendar = calendar.id;
          });
        });
      });
    });
  });

  robot.respond(/create(me )?( an)? event (.*)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
      getPrimaryCalendar(oauth, function(err, calendar) {
        if(err || !calendar) return msg.reply("Could not find your primary calendar");
        googleapis
        .calendar('v3')
        .events.quickAdd({ auth: oauth, calendarId: calendar.id, text: msg.match[3] }, function(err, event) {
          if(err || !event) return msg.reply("Error creating an event for " + calendar.summary);
          var id = event.id;
          msg.message.user.last_event = id;
          msg.message.user.last_event_calendar = calendar.id;
          reply_with_new_event(msg, event, "OK, I created an event for you:");
        });
      });
    });
  });

  robot.respond(/invite (.*)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
      var event = msg.message.user.last_event;
      if(!event) return msg.reply('I dont know what event you\'re talking about!');
      getPrimaryCalendar(oauth, function(err, calendar_o) {
        if(err || !calendar_o) return msg.reply("Could not find your primary calendar");
        var calendar = calendar_o.id;
        var emails;
        try {
        	emails = helpers.get_emails_from_usernames(robot, msg.match[1].split(' '));
        } catch(e) {
        	msg.reply(e);
        }
        if(emails && emails.length == 0) return msg.reply('No valid users given');
        googleapis.calendar('v3').events.get({ auth: oauth, alwaysIncludeEmail: true, calendarId: calendar, eventId: event }, function(err, event) {
          if(err) return msg.reply('Error getting event: ' + err);
          var current_emails = _.map(event.attendees, function(a) {
            return { email: a.email };
          });
          googleapis.calendar('v3').events.patch({ auth: oauth, calendarId: calendar, eventId: event.id, resource: { attendees: _.union(emails, current_emails) } }, function(err, event) {
            if(err) return msg.reply('Error inviting users: ' + err);
            msg.reply("OK, I invited them.");
          });
        });
      });
    });
  });

  var response_map = {
    "no": "declined",
    "maybe": "tentative",
    "yes": "accepted"
  };
  robot.respond(/(respond|reply) (yes|no|maybe)/i, function(msg) {
    robot.emit('google:authenticate', msg, function(err, oauth) {
      var event = msg.message.user.last_event;
      if(!event) return msg.reply('I dont know what event you\'re talking about!');
      getPrimaryCalendar(oauth, function(err, calendar_o) {
        if(err || !calendar_o) return msg.reply("Could not find your primary calendar");
        var calendar = calendar_o.id;
        googleapis.calendar('v3').events.get({ auth: oauth, alwaysIncludeEmail: true, calendarId: calendar, eventId: event }, function(err, event) {
          if(err) return msg.reply('Error getting event: ' + err);
          var attendees = event.attendees;
          var me = _.find(attendees, function(a) { return a.self });
          if(!me) return msg.reply("You are not invited to " + event.summary);
          me.responseStatus = response_map[msg.match[2]];
          googleapis.calendar('v3').events.patch({ auth: oauth, calendarId: calendar, eventId: event.id, resource: { attendees: attendees } }, function(err, event) {
            if(err) return msg.reply('Error saving status: ' + err);
            msg.reply("OK, you responded " + msg.match[2] + " to " + event.summary);
          });
        });
      });
    });
  });
}