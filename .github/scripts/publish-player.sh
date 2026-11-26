#!/usr/bin/env bash
# Выкладывает «Куплет» в постоянный релиз «player».
set -euo pipefail
repo="$1"
version="$2"
dist=player/desktop/dist
notes="Скачайте Kuplet-Setup.exe и запустите. Если программа уже установлена, она сама предложит обновиться. Текущая версия: $version."

if ! gh release view player --repo "$repo" > /dev/null 2>&1; then
  gh release create player --repo "$repo" --latest=false --title "Куплет" --notes "$notes"
fi

# постоянное имя — для ссылки на скачивание
cp "$dist/Kuplet-Setup-$version.exe" "$dist/Kuplet-Setup.exe"
gh release upload player --repo "$repo" --clobber \
  "$dist/Kuplet-Setup-$version.exe" "$dist/Kuplet-Setup-$version.exe.blockmap" "$dist/Kuplet-Setup.exe"
# описание версии — последним: к этому моменту сам установщик уже на месте
gh release upload player --repo "$repo" --clobber "$dist/latest.yml"
gh release edit player --repo "$repo" --latest=false --title "Куплет $version" --notes "$notes"

# старые версии не копим: оставляем пять последних
gh release view player --repo "$repo" --json assets --jq '.assets[].name' \
  | tr -d '\r' | grep -E '^Kuplet-Setup-[0-9.]+\.exe$' | sort -V | head -n -5 \
  | while read -r old; do
      gh release delete-asset player "$old" --repo "$repo" --yes || true
      gh release delete-asset player "$old.blockmap" --repo "$repo" --yes || true
    done
