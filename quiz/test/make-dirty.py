# 造一份「脏格式」测试题库 docx：合并选项、圈号选项、制表符选项、图片、题干表格、判断、隐藏答案、文末答案表
import zipfile, base64, os

PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
PIC = 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'


def run(text, color=None, vanish=False, bold=False):
    props = ''
    if bold or color or vanish:
        props = '<w:rPr>' + ('<w:b/>' if bold else '') + \
                (f'<w:color w:val="{color}"/>' if color else '') + \
                ('<w:vanish/>' if vanish else '') + '</w:rPr>'
    return f'<w:r>{props}<w:t xml:space="preserve">{text}</w:t></w:r>'


def p(content, style=None):
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    return f'<w:p>{ppr}{content}</w:p>'


def tab():
    return '<w:r><w:tab/></w:r>'


def img_p(rid='rId10'):
    return ('<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>'
            '<wp:docPr id="1" name="Picture 1" descr="题图：一个红点"/>'
            f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic {PIC}><pic:nvPicPr><pic:cNvPr id="1" name="img"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')


def table(rows):
    out = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    for row in rows:
        out += '<w:tr>'
        for cell in row:
            out += f'<w:tc><w:p>{run(cell)}</w:p></w:tc>'
        out += '</w:tr>'
    return out + '</w:tbl>'


body = []
body.append(p(run('某高校 2026 年知识竞赛题库（脏格式测试）', bold=True)))
body.append(p(run('一、单选题', bold=True)))

# 1 普通分行选项（答案在文末）
body.append(p(run('1. 中国共产党成立于哪一年？')))
body.append(p(run('A.1921 年')))
body.append(p(run('B.1927 年')))
body.append(p(run('C.1935 年')))
body.append(p(run('D.1949 年')))

# 2 选项挤在一段
body.append(p(run('2. 下列哪个是合并选项的题？')))
body.append(p(run('A.甲选项B.乙选项C.丙选项D.丁选项')))

# 3 圈号选项
body.append(p(run('3. 圈号选项的题，正确答案是丁。')))
body.append(p(run('①甲项 ②乙项 ③丙项 ④丁项')))

# 4 制表符选项
body.append(p(run('4. 制表符分隔的选项题。') + tab()))
body.append(p(run('A.春') + tab() + run('B.夏') + tab() + run('C.秋') + tab() + run('D.冬')))

# 5 带图片
body.append(p(run('5. 图中是什么颜色？')))
body.append(img_p())
body.append(p(run('A.红色')))
body.append(p(run('B.蓝色')))
body.append(p(run('C.绿色')))
body.append(p(run('D.黑色')))

# 6 题干里带表格
body.append(p(run('6. 根据下表判断颜色：')))
body.append(table([['项目', '内容'], ['颜色', '红色']]))
body.append(p(run('A.红色B.蓝色C.绿色D.黄色')))

body.append(p(run('二、判断题', bold=True)))
body.append(p(run('1. 地球是圆的。')))
body.append(p(run('答案：对')))
body.append(p(run('2. 太阳从西边升起。')))
body.append(p(run('答案:×')))
body.append(p(run('3. 隐藏答案的判断题：1+1=2。')))
body.append(p(run('对', vanish=True)))  # 隐藏文字当答案

body.append(p(run('三、多选题', bold=True)))
body.append(p(run('1. 下列哪些是偶数？')))
body.append(p(run('A.2') + tab() + run('B.3') + tab() + run('C.4') + tab() + run('D.5')))
body.append(p(run('答案：AC')))
body.append(p(run('解析：2 和 4 是偶数。')))
body.append(p(run('2. 下列哪些是质数？')))
body.append(p(run('①2 ②3 ③4 ④5')))
body.append(p(run('答案：ABD')))

body.append(p(run('四、填空题', bold=True)))
body.append(p(run('1. 中国的首都是 ▲ 。')))
body.append(p(run('答案：北京')))
body.append(p(run('2. 一年有 ▲ 个月。')))
body.append(p(run('答案：12')))

body.append(p(run('五、简答题', bold=True)))
body.append(p(run('1. 请简述本题库的用途。')))
body.append(p(run('答案：用于测试解析器')))

body.append(p(run('参考答案', bold=True)))
body.append(table([['题号', '答案'], ['1', 'A'], ['2', 'B'], ['3', 'D'], ['4', 'C'], ['5', 'A'], ['6', 'B']]))

document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document {W} {R} {A} {WP}><w:body>' + ''.join(body) + '</w:body></w:document>')

content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="png" ContentType="image/png"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>')

root_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>')

doc_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    '</Relationships>')

out = os.path.join(os.path.dirname(__file__), '..', 'samples', 'dirty.docx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('word/document.xml', document)
    z.writestr('word/_rels/document.xml.rels', doc_rels)
    z.writestr('word/media/image1.png', PNG)
print('written', out, os.path.getsize(out), 'bytes')
