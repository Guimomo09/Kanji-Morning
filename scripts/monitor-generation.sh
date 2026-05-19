#!/bin/bash
# Monitor vocab sentence generation progress

LOG_FILE="/tmp/vocab-generation.log"
TARGET=4522
START_TIME="03:56"

while true; do
  if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Log file not found: $LOG_FILE"
    exit 1
  fi

  CURRENT=$(tail -1 "$LOG_FILE" | grep -oE '[0-9]+/4522' | cut -d'/' -f1 || echo "0")
  FOUND=$(tail -1 "$LOG_FILE" | grep -oE '[0-9]+ sentences found' | grep -oE '[0-9]+' || echo "0")
  PERCENT=$(echo "scale=1; $CURRENT * 100 / $TARGET" | bc)
  
  clear
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 GÉNÉRATION 4522 PHRASES TATOEBA"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "🕐 Début         : $START_TIME"
  echo "⏰ Maintenant    : $(date +%H:%M)"
  echo ""
  
  # Progress bar
  FILLED=$((CURRENT * 50 / TARGET))
  BAR=$(printf "%${FILLED}s" | tr ' ' '█')
  EMPTY=$(printf "%$((50 - FILLED))s" | tr ' ' '░')
  echo "📈 Progression   : $CURRENT / $TARGET mots ($PERCENT%)"
  echo "    [$BAR$EMPTY]"
  echo ""
  echo "✅ Phrases       : $FOUND trouvées"
  echo ""
  
  # Check if complete
  if [ "$CURRENT" -eq "$TARGET" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎉 GÉNÉRATION TERMINÉE !"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📝 Fichiers générés :"
    echo "   • scripts/vocab-db.json"
    echo "   • public/sentences.json"
    echo ""
    echo "🚀 Prochaine étape : Commit + Push + Deploy"
    exit 0
  fi
  
  echo "📝 Dernières lignes :"
  tail -3 "$LOG_FILE" | sed 's/^/   /'
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Rafraîchissement toutes les 30 secondes (Ctrl+C pour quitter)..."
  
  sleep 30
done
