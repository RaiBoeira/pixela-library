# Favorites Sync via Google Apps Script

Use este Apps Script para sincronizar favoritos da Pixela Library entre dispositivos.

## Publicacao

1. Crie uma planilha Google.
2. Abra `Extensions > Apps Script`.
3. Cole o conteudo de `FavoritesSync.gs`.
4. Opcionalmente configure a propriedade de script `PIXELA_API_KEY`.
5. Clique em `Deploy > New deployment`.
6. Tipo: `Web app`.
7. Execute as: `Me`.
8. Access: `Anyone`.
9. Copie a URL publicada.

## Configuracao do site

Edite `web/config.js`:

```js
window.PIXELA_CONFIG = {
  favorites: {
    enabled: true,
    endpoint: "SUA_URL_DO_APPS_SCRIPT",
    apiKey: "SUA_CHAVE_OPCIONAL",
  },
};
```

## Observacao

Se o site estiver publico no GitHub Pages, qualquer chave no frontend tambem pode ser vista por quem inspecionar o codigo.
