var ElementType = require("./ElementType.js");

function Parser(handler, options) {
    this._options = options ? options : {};
    if (this._options.includeLocation === undefined) {
        this._options.includeLocation = false; //Do not track element position in document by default
    }

    this.validateHandler(handler);
    this._handler = handler;

    this._buffer = "";
    this._done = false;
    this._elements = [];
    this._elementsCurrent = 0;
    this._current = 0;
    this._next = 0;
    this._location = {
        row: 0,
        col: 0,
        charOffset: 0,
        inBuffer: 0
    };
    this._parseState = ElementType.Text;
    this._prevTagSep = "";
    this._tagStack = [];
}

//**"Static"**//
//Regular expressions used for cleaning up and parsing (stateless)
var _reTrimComment = /(^\!--|--$)/g; //Remove comment tag markup from comment contents
var _reWhitespace = /\s/; //Used to find any whitespace to split on
var _reTagName = /^\s*(\/?)\s*([^\s\/]+)/; //Used to find the tag name for an element

//Regular expressions used for parsing (stateful)
var _reAttrib = /([^=<>\"\'\s]+)\s*=\s*"([^"]*)"|([^=<>\"\'\s]+)\s*=\s*'([^']*)'|([^=<>\"\'\s]+)\s*=\s*([^'"\s]+)|([^=<>\"\'\s\/]+)/g; //Find attributes in a tag
var _reTags = /[<\>]/g; //Find tag markers

var tagTypes = {};
tagTypes[ElementType.Script] = true;
tagTypes[ElementType.Style] = true;
tagTypes[ElementType.Tag] = true;

//**Public**//
//Methods//
//Parses a complete HTML and pushes it to the handler
Parser.prototype.parseComplete = function(data) {
    this.reset();
    this.parseChunk(data);
    this.done();
};

//Parses a piece of an HTML document
Parser.prototype.parseChunk = function(data) {
    if (this._done)
        this.handleError(
            Error("Attempted to parse chunk after parsing already done")
        );
    this._buffer += data; //FIXME: this can be a bottleneck
    this.parseTags();
};

//Tells the parser that the HTML being parsed is complete
Parser.prototype.done = function() {
    if (this._done) return;
    this._done = true;

    //Push any unparsed text into a final element in the element list
    if (this._buffer.length) {
        var rawData = this._buffer;
        this._buffer = "";
        var element = {
            raw: rawData,
            data:
                this._parseState === ElementType.Text
                    ? rawData
                    : rawData.trim(),
            type: this._parseState
        };
        if (tagTypes[this._parseState])
            element.name = this.parseTagName(element.data);
        this.parseAttribs(element);
        this._elements.push(element);
    }

    this.writeHandler();
    this._handler.done();
};

//Resets the parser to a blank state, ready to parse a new HTML document
Parser.prototype.reset = function() {
    this._buffer = "";
    this._prevTagSep = "";
    this._done = false;
    this._elementsCurrent = 0;
    this._current = 0;
    this._next = 0;
    this._location = {
        row: 0,
        col: 0,
        charOffset: 0,
        inBuffer: 0
    };
    this._parseState = ElementType.Text;
    this._tagStack = [];
    this._elements = [];
    this._handler.reset();
};

//**Private**//
//Methods//
//Takes an array of elements and parses any found attributes
Parser.prototype.parseTagAttribs = function(elements) {
    for (var i = 0, j = elements.length; i < j; i++) {
        var element = elements[i];
        if (tagTypes[element.type]) this.parseAttribs(element);
    }

    return elements;
};

//Takes an element and adds an "attribs" property for any element attributes found
Parser.prototype.parseAttribs = function(element) {
    //Only parse attributes for tags
    if (!tagTypes[element.type]) return;

    var tagName = element.data.split(_reWhitespace, 1)[0];
    var attribRaw = element.data.substring(tagName.length);
    if (attribRaw.length < 1) return;

    var match;
    _reAttrib.lastIndex = 0;
    while ((match = _reAttrib.exec(attribRaw))) {
        if (element.attribs === undefined) element.attribs = {};

        if (typeof match[1] === "string" && match[1].length) {
            element.attribs[match[1]] = match[2];
        } else if (typeof match[3] === "string" && match[3].length) {
            element.attribs[match[3].toString()] = match[4].toString();
        } else if (typeof match[5] === "string" && match[5].length) {
            element.attribs[match[5]] = match[6];
        } else if (typeof match[7] === "string" && match[7].length) {
            element.attribs[match[7]] = match[7];
        }
    }
};

//Extracts the base tag name from the data value of an element
Parser.prototype.parseTagName = function(data) {
    if (!data) return "";
    var match = _reTagName.exec(data);
    if (!match) return "";
    return (match[1] ? "/" : "") + match[2];
};

//Parses through HTML text and returns an array of found elements
//I admit, this function is rather large but splitting up had an noticeable impact on speed
Parser.prototype.parseTags = function() {
    var bufferEnd = this._buffer.length - 1;
    while (_reTags.test(this._buffer)) {
        this._next = _reTags.lastIndex - 1;
        var tagSep = this._buffer.charAt(this._next); //The currently found tag marker
        var rawData = this._buffer.substring(this._current, this._next); //The next chunk of data to parse

        //A new element to eventually be appended to the element list
        var element = {
            raw: rawData,
            data:
                this._parseState === ElementType.Text
                    ? rawData
                    : rawData.trim(),
            type: this._parseState
        };

        var elementName = this.parseTagName(element.data),
            prevElement,
            rawLen;

        //This section inspects the current tag stack and modifies the current
        //element if we're actually parsing a special area (script/comment/style tag)
        if (this._tagStack.length) {
            //We're parsing inside a script/comment/style tag
            var type = this._tagStack[this._tagStack.length - 1];
            if (type === ElementType.Script) {
                //We're currently in a script tag
                if (elementName === "/script")
                    //Actually, we're no longer in a script tag, so pop it off the stack
                    this._tagStack.pop();
                else {
                    //Not a closing script tag
                    if (rawData.substring(0, 3) !== "!--") {
                        //Make sure we're not in a comment
                        //All data from here to script close is now a text element
                        element.type = ElementType.Text;
                        //If the previous element is text, append the current text to it
                        if (
                            this._elements.length &&
                            this._elements[this._elements.length - 1].type ===
                                ElementType.Text
                        ) {
                            prevElement = this._elements[
                                this._elements.length - 1
                            ];
                            prevElement.raw = prevElement.data =
                                prevElement.raw + this._prevTagSep + rawData;
                            element.raw = element.data = ""; //This causes the current element to not be added to the element list
                        }
                    }
                }
            } else if (type === ElementType.Style) {
                //We're currently in a style tag
                if (elementName === "/style")
                    //Actually, we're no longer in a style tag, so pop it off the stack
                    this._tagStack.pop();
                else {
                    if (rawData.substring(0, 3) !== "!--") {
                        //Make sure we're not in a comment
                        //All data from here to style close is now a text element
                        element.type = ElementType.Text;
                        //If the previous element is text, append the current text to it
                        if (
                            this._elements.length &&
                            this._elements[this._elements.length - 1].type ===
                                ElementType.Text
                        ) {
                            prevElement = this._elements[
                                this._elements.length - 1
                            ];
                            if (rawData !== "") {
                                prevElement.raw = prevElement.data =
                                    prevElement.raw +
                                    this._prevTagSep +
                                    rawData;
                                element.raw = element.data = ""; //This causes the current element to not be added to the element list
                            } else {
                                //Element is empty, so just append the last tag marker found
                                prevElement.raw = prevElement.data =
                                    prevElement.raw + this._prevTagSep;
                            }
                        } else {
                            //The previous element was not text
                            if (rawData !== "") element.data = rawData;
                        }
                    }
                }
            } else if (type === ElementType.Comment) {
                //We're currently in a comment tag
                if (rawData.substr(-2) === "--" && tagSep === ">") {
                    //Actually, we're no longer in a style tag, so pop it off the stack
                    this._tagStack.pop();
                    //If the previous element is a comment, append the current text to it
                    if (
                        this._elements.length &&
                        this._elements[this._elements.length - 1].type ===
                            ElementType.Comment
                    ) {
                        prevElement = this._elements[this._elements.length - 1];
                        prevElement.raw = prevElement.data = (
                            prevElement.raw + element.raw
                        ).replace(_reTrimComment, "");
                        element.raw = element.data = ""; //This causes the current element to not be added to the element list
                        element.type = ElementType.Text;
                    } //Previous element not a comment
                    else element.type = ElementType.Comment; //Change the current element's type to a comment
                } else {
                    //Still in a comment tag
                    element.type = ElementType.Comment;
                    //If the previous element is a comment, append the current text to it
                    if (
                        this._elements.length &&
                        this._elements[this._elements.length - 1].type ===
                            ElementType.Comment
                    ) {
                        prevElement = this._elements[this._elements.length - 1];
                        prevElement.raw = prevElement.data =
                            prevElement.raw + element.raw + tagSep;
                        element.raw = element.data = ""; //This causes the current element to not be added to the element list
                        element.type = ElementType.Text;
                    } else element.raw = element.data = element.raw + tagSep;
                }
            }
        }

        //Processing of non-special tags
        if (element.type === ElementType.Tag) {
            if (element.raw.substring(0, 3) === "!--") {
                //This tag is really comment
                element.type = ElementType.Comment;
                rawLen = element.raw.length;
                //Check if the comment is terminated in the current element
                if (element.raw.substr(-2) === "--" && tagSep === ">")
                    element.raw = element.data = element.raw.replace(
                        _reTrimComment,
                        ""
                    );
                else {
                    //It's not so push the comment onto the tag stack
                    element.raw += tagSep;
                    this._tagStack.push(ElementType.Comment);
                }
            } else {
                element.name = elementName;

                if (element.raw[0] === "!" || element.raw[0] === "?") {
                    element.type = ElementType.Directive;
                    //TODO: what about CDATA?
                } else if (elementName[0] === "/") {
                    element.data = element.name;
                    if (elementName === "/script")
                        element.type = ElementType.Script;
                    else if (elementName === "/style")
                        element.type = ElementType.Style;
                } else if (elementName === "script") {
                    element.type = ElementType.Script;
                    //Special tag, push onto the tag stack if not terminated
                    if (element.data.substr(-1) !== "/")
                        this._tagStack.push(ElementType.Script);
                } else if (elementName === "style") {
                    element.type = ElementType.Style;
                    //Special tag, push onto the tag stack if not terminated
                    if (element.data.substr(-1) !== "/")
                        this._tagStack.push(ElementType.Style);
                }
            }
        }

        //Add all tags and non-empty text elements to the element list
        if (element.raw !== "" || element.type !== ElementType.Text) {
            if (this._options.includeLocation && !element.location) {
                element.location = this.getLocation(
                    element.type === ElementType.Tag
                );
            }
            this.parseAttribs(element);
            this._elements.push(element);
            //If tag self-terminates, add an explicit, separate closing tag
            if (
                element.type !== ElementType.Text &&
                element.type !== ElementType.Comment &&
                element.type !== ElementType.Directive &&
                element.data.substr(-1) === "/"
            )
                this._elements.push({
                    raw: "/" + element.name,
                    data: "/" + element.name,
                    name: "/" + element.name,
                    type: element.type
                });
        }
        this._parseState = tagSep === "<" ? ElementType.Tag : ElementType.Text;
        this._current = this._next + 1;
        this._prevTagSep = tagSep;
    }

    if (this._options.includeLocation) {
        this.getLocation();
        this._location.row += this._location.inBuffer;
        this._location.inBuffer = 0;
        this._location.charOffset = 0;
    }
    this._buffer =
        this._current <= bufferEnd ? this._buffer.substring(this._current) : "";
    this._current = 0;

    this.writeHandler();
};

Parser.prototype.getLocation = function(startTag) {
    var c,
        l = this._location,
        end = this._current,
        chunk = startTag && l.charOffset === 0 && end === 0;

    if (startTag) end--;

    for (; l.charOffset < end; l.charOffset++) {
        c = this._buffer[l.charOffset];
        if (c === "\n") {
            l.inBuffer++;
            l.col = 0;
        } else if (c !== "\r") l.col++;
    }
    return {
        line: l.row + l.inBuffer + 1,
        col: l.col + (chunk ? 0 : 1)
    };
};

//Checks the handler to make it is an object with the right "interface"
Parser.prototype.validateHandler = function(handler) {
    if (typeof handler !== "object") throw Error("Handler is not an object");
    [
        "reset",
        "done",
        "writeTag",
        "writeText",
        "writeComment",
        "writeDirective"
    ].forEach(function(name) {
        if (typeof handler[name] !== "function")
            throw Error("Handler method '" + name + "' is invalid");
    });
};

//Writes parsed elements out to the handler
Parser.prototype.writeHandler = function(forceFlush) {
    if (this._tagStack.length && !forceFlush) return;
    while (this._elements.length) {
        var element = this._elements.shift();
        switch (element.type) {
            case ElementType.Comment:
                this._handler.writeComment(element);
                break;
            case ElementType.Directive:
                this._handler.writeDirective(element);
                break;
            case ElementType.Text:
                this._handler.writeText(element);
                break;
            default:
                this._handler.writeTag(element);
        }
    }
};

Parser.prototype.handleError = function(error) {
    if (typeof this._handler.error === "function") this._handler.error(error);
    else throw error;
};

module.exports = Parser;
