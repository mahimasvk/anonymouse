# Anonymouse - An Anonymous Discord Feedback Messaging Bot

this is a small discord bot for anonymous feedback/messages.

a user can directly message the bot, and the bot forwards that message into a private staff channel using an anonymous id like `Anon-1234`.

staff can then reply back to the user without knowing who they are.

## what it does

* user directly messages the bot
* bot creates an anonymous ticket channel
* bot gives the user an anonymous id
* staff sees the message in the ticket channel
* staff can reply with `/reply`
* staff can close the conversation with `/close`
* attachments get forwarded too
* ticket info gets saved in `tickets.json`

## how it stays anonymous 

when someone messages the bot, the bot makes an id, such as:

```txt
Anon-4821
```

it then stores the link between the real discord user and the anonymous id in `tickets.json`.

staff can only see the anon id in the ticket channel when replying.

## commands

### `/reply`

used inside a ticket channel.

sends a message back to the anonymous user.

example:

```txt
/reply message: thank you for letting us know!
```

### `/close`

used inside a ticket channel.

closes the anonymous conversation and removes it from `tickets.json`.

## env variables

the bot expects these values from environment variables:

```env
TOKEN=your bot token
CLIENT_ID=your discord app client id
GUILD_ID=your server id
STAFF_CATEGORY_ID=category id where ticket channels should be made
```

## notes
* if we want only a certain staff role to use `/reply` and `/close`, add the role id there
* `tickets.json` should not be pushed because it stores user-ticket mappings
* the bot should have message content intent enabled in the discord developer portal
* the bot needs permission to create channels under the staff category
