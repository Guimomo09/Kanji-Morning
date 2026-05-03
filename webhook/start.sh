#!/bin/bash
set -a
source /etc/asa-no-kanji/.env
set +a
exec node /var/www/kanji-webhook/webhook/server.js
