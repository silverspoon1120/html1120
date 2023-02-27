exports.name = "Unescaped chars in style";
exports.html =
    '<style type="text/css">\n body > p\n	{ font-weight: bold; }</style>';
exports.expected = [
    {
        raw: 'style type="text/css"',
        data: 'style type="text/css"',
        type: "style",
        name: "style",
        children: [
            {
                raw: "\n body > p\n	{ font-weight: bold; }",
                data: "\n body > p\n	{ font-weight: bold; }",
                type: "text"
            }
        ]
    }
];
