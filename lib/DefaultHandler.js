var ElementType = require("./ElementType.js");

function DefaultHandler(callback, options) {
    this.dom = [];
    this._done = false;
    this._inSpecialTag = false;
    this._tagStack = [];
    if (options) this._options = options; //otherwise, the prototype is used
    if (callback) this._callback = callback;
}

//default options
DefaultHandler.prototype._options = {
    ignoreWhitespace: false //Keep whitespace-only text nodes
};

//Resets the handler back to starting state
DefaultHandler.prototype.onreset = DefaultHandler;

//Signals the handler that parsing is done
DefaultHandler.prototype.onend = function() {
    if (this._done) return;
    this._done = true;
    this._handleCallback(null);
};

DefaultHandler.prototype.onerror = function(error) {
    if (typeof this._callback === "function") {
        return this._callback(error, this.dom);
    } else {
        if (error) throw error;
    }
};

DefaultHandler.prototype._handleCallback = DefaultHandler.prototype.onerror;

DefaultHandler.prototype.onclosetag = function(name) {
    this._tagStack.pop();
};

DefaultHandler.prototype._addDomElement = function(element) {
    var lastChild,
        lastTag = this._tagStack[this._tagStack.length - 1];

    if (lastTag) {
        //There are parent elements
        if (!lastTag.children) {
            lastTag.children = [element];
            return;
        }
        lastChild = lastTag.children[lastTag.children.length - 1];
        if (
            this._inSpecialTag &&
            element.type === ElementType.Text &&
            lastChild.type === ElementType.Text
        ) {
            lastChild.data += element.data;
        } else {
            lastTag.children.push(element);
        }
    } else {
        this.dom.push(element);
    }
};

DefaultHandler.prototype.onopentag = function(name, attribs, type) {
    if (type === ElementType.Script || type === ElementType.Style) {
        this._inSpecialTag = true;
    }
    var element = {
        type: type,
        name: name,
        attribs: attribs
    };
    this._addDomElement(element);
    this._tagStack.push(element);
};

DefaultHandler.prototype.ontext = function(data) {
    if (this._options.ignoreWhitespace && data.trim() === "") return;
    this._addDomElement({
        data: data,
        type: ElementType.Text
    });
};

DefaultHandler.prototype.oncomment = function(data) {
    var lastTag = this._tagStack[this._tagStack.length - 1];
    var lastChild =
        lastTag &&
        lastTag.children &&
        lastTag.children[lastTag.children.length - 1];

    var element;
    if (!lastChild || lastChild.type !== ElementType.Comment) {
        element = {
            data: data,
            type: ElementType.Comment
        };
        if (!lastTag) {
            return this.dom.push(element);
        } else if (!lastChild) {
            lastTag.children = [element];
        } else {
            if (lastChild.type !== ElementType.Comment) {
                lastTag.children.push(element);
            }
        }
    } else {
        lastChild.data += data;
    }
};

DefaultHandler.prototype.onprocessinginstruction = function(name, data) {
    this._addDomElement({
        name: name,
        data: data,
        type: ElementType.Directive
    });
};

module.exports = DefaultHandler;
