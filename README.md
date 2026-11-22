# Designer JRXML

Extensão do VS Code para editar relatórios JasperReports (`.jrxml`) visualmente, no estilo do iReport: bandas, paleta de elementos, inspector e painel de propriedades.

O XML gerado segue as regras do JasperReports 4.0.2.

## Recursos

- Canvas com as bandas do relatório (title, pageHeader, columnHeader, detail, columnFooter, pageFooter, summary, grupos etc.)
- Paleta: Static Text, Text Field, Image, Line, Rectangle, Ellipse, Frame e Subreport
- Inspector com a árvore do relatório e painel de propriedades
- Copiar e colar elementos entre relatórios abertos
- Desfazer/refazer e salvar integrados ao VS Code
- Botão para abrir o XML ao lado, já posicionado no elemento

## Uso

Abra um arquivo `.jrxml` e clique em **Abrir no Designer JRXML**, na barra de título do editor ou no menu de contexto do Explorer. Para voltar ao XML, use **Ver XML do relatório**.

## Instalação

Baixe o `.vsix` na página de [Releases](../../releases) e instale:

```sh
code --install-extension jrxml-band-designer-0.2.0.vsix
```

Para gerar o pacote a partir do código:

```sh
npx @vscode/vsce package
```

## Licença

[MIT](LICENSE)
