# Pixela Library Web

Pasta unica da versao web da Pixela Library.

## Estrutura

- `index.html`: interface principal
- `styles.css`: visual da galeria
- `app.js`: filtros, favoritos, downloads e exportacao
- `generate_catalog_drive.py`: gera `catalogo.json` a partir do link publico do Google Drive
- `generate_catalog_local.py`: gera `catalogo.json` a partir da biblioteca local
- `start-drive-preview.ps1`: regenera catalogo do Drive e abre preview local
- `start-local-preview.ps1`: regenera catalogo local e abre preview local

## Modo recomendado

Hoje o modo principal e o do Google Drive.

Rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\start-drive-preview.ps1
```

Depois abra:

```text
http://127.0.0.1:8123/web/
```

## Modo local

Se quiser montar o catalogo a partir da pasta sincronizada/local:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\start-local-preview.ps1
```

## Observacoes

- `catalogo.json` dentro de `web` e sobrescrito pelo gerador escolhido
- favoritos podem ser sincronizados via Google Apps Script
- downloads em lote sao gerados como `.zip`

## GitHub Pages

Esta pasta ja esta preparada para publicacao no GitHub Pages com atualizacao automatica do catalogo do Drive.

Arquivos importantes:

- `.github/workflows/update-catalog.yml`: atualiza `web/catalogo.json` automaticamente
- `.github/workflows/deploy-pages.yml`: publica a pasta `web` no GitHub Pages
- `web/requirements.txt`: dependencias Python do gerador

Fluxo esperado:

1. subir este projeto para um repositorio GitHub
2. manter a branch principal como `main`
3. em `Settings > Pages`, selecionar `GitHub Actions` como source
4. o workflow `Update Drive Catalog` vai regenerar o catalogo em horarios agendados
5. qualquer mudanca em `web/catalogo.json` dispara o deploy do Pages

Agenda atual do catalogo:

- a cada 15 minutos, nos minutos `07`, `22`, `37` e `52` de cada hora, em UTC

URL esperada depois do deploy:

```text
https://SEU_USUARIO.github.io/SEU_REPOSITORIO/
```

## Favoritos sincronizados

Para usar favoritos permanentes entre dispositivos:

1. configure `web/config.js`
2. publique o Apps Script usando os arquivos em `apps-script/`

Arquivos:

- `web/config.js`: configuracao ativa do frontend
- `web/config.example.js`: exemplo de configuracao
- `apps-script/FavoritesSync.gs`: backend do Apps Script
- `apps-script/README.md`: passo a passo de publicacao

Sem configurar isso, o site continua com favoritos locais no navegador.
