function Atom(name){
	if(typeof name == 'boolean'){
		if(name)
			this.root = true;
		else
			throw new Error('First arg for atom is either a 4 letter tag name, or boolean true for the root');
	}else if(name.length !== 4)
		throw new Error('Atoms must have name length of 4');
	else
		this.name = name;
	
	this.padding = 0;
	this.children = [];
	this.data = new jDataView(new Uint8Array(0));
	this.parent = false;

	this.hasChild = function(name){
		return(this.indexOf(name) !== -1)
	}

	this.getByteLength = function(){
		if(this.data)
			return this.data.byteLength + 8;
		var len = 8 + this.padding;
		for(var i in this.children)
			len += this.children[i].getByteLength();
		return len;
	};

	this.toString = function(string, indent){
		var string = '';
		var indent = indent || 0;
		var i = indent;
		while(i--)
			string += '| ';
		i = 0;
		string += (this.root ? 'MP4:' :  this.name);

		if(this.data)
			string += ' => ' + (this.padding ? this.padding + 'pad' : '') + ' data' ;
		else
			for(var i in this.children)
				string += '\n' + this.children[i].toString(string, indent + 1)
		return string
	}

	this.indexOf = function(name){
		for(var i in this.children)
			if(this.children[i].name == name)
				return i;
		return -1;
	}

	this.getChildByName = function(name){
		for(var i in this.children)
			if(this.children[i].name == name)
				return this.children[i];
		return false;
	}

	this.ensureChild = function(childName){
		
		childName = childName.split('.');
		
		var child = childName[0];

		if(!this.hasChild(child))
			this.addChild(new Atom(child));

		child = this.getChildByName(child);


		if(childName[1]){
			childName.shift();
			return child.ensureChild(childName.join('.'));
		}
		return child;
		
	};

	this.addChild = function(atom, index){
		atom.parent = this;
		if(typeof index === 'undefined'){
			this.children.push(atom);
			return atom;
		}
		index = Math.max(index,0);
		index = Math.min(this.children.length, index);

		atom.parent = this;
		
		this.children.splice(index, 0, atom);
		return atom;
	};
};

MP4 = {};
MP4.parse = function(input){
	var data = input;	
	
	if(!jDataView)
		throw new Error("Include jDataView to use mp4.js");
	else if(!data.jDataView)
		data = new jDataView(new Uint8Array(input));
	

	var recursiveParse = function(atom, data){
		var tags = {};

		while( data.byteLength >= 8 ){
			data.seek(0);
			var tagLength = (data.getUint32(0));
			var tagName  = (data.getString(4,4));
		
			
			if(tagName.match(/\w{4}/) && tagLength <= data.byteLength){
				var child = atom.addChild(new Atom(tagName));

				if(tagName == 'meta')
					child.padding = 4;
				atom.children.push(child);
				recursiveParse(child, data.slice(8+child.padding,tagLength));
				data = data.slice(tagLength, data.byteLength);
			}else{
				atom.data = data;
				return;
			}
		}
	}

	var root = new Atom(true);
	recursiveParse(root, data);

	return root;
}

MP4.concatBuffers = function(buf1, buf2){
	var newbuf = new Uint8Array(buf1.byteLength + buf2.byteLength);

	var i = buf1.byteLength;
	buf1.seek(0);
	while(i)
		newbuf[buf1.byteLength-(i--)] = buf1.getUint8(buf1.tell());
	i = buf2.byteLength;
	buf2.seek(0);
	while(i)
		newbuf[buf1.byteLength+buf2.byteLength-(i--)] = buf2.getUint8(buf2.tell());
	return new jDataView(newbuf);

}

MP4.make = function(root){
	if(!jDataView)
		throw new Error("Include jDataView to use mp4.js");
	var output = new jDataView(new Uint8Array());

	if(root.data)
		return root.data;

	var i;
	for(i = 0; i<root.children.length; i++){
		var child = root.children[i];
		var buffer = new Uint8Array();
		var header;
	
		var header = new jDataView(new Uint8Array(8+child.padding));
			
		var data = MP4.make(child);

		header.writeUint32(data.byteLength + 8 + child.padding);
		header.seek(4);
	
		for(var j = 0; j < 4; j++){
			header.writeUint8(root.children[i].name.charCodeAt(j))
		}

		
		var buffer = this.concatBuffers(header, data);
		output = this.concatBuffers(output, buffer);
		
	}
	return output;
}


MP4.giveTags = function(mp4, tags){
	if(!tags || typeof tags !== 'object')
		throw new Error("MP4.giveTags needs to be given tags (as a js object - see docs for options)");
	var metadata = mp4.ensureChild("moov.udta.meta.ilst");
	
	var hdlr = metadata.parent.addChild(new Atom('hdlr'), 0);
	hdlr.data = new jDataView(new Uint8Array(25));
	hdlr.data.seek(8);
	hdlr.data.writeString('mdirappl');
	metadata.parent.padding = 4; 
	
	var addDataAtom = function(atom, name, str){
		var leaf = atom.addChild(new Atom(name));
		var data = leaf.addChild(new Atom('data'));
		if(str){
			data.data = new jDataView(new Uint8Array(str.length + 8));
			data.data.seek(3);
			data.data.writeUint8(1);
			data.data.seek(8);
			data.data.writeString(str);
		}
		return data;
	}

	if(tags.title)
		addDataAtom(metadata, '\xA9nam', tags.title);
	if(tags.artist)
		addDataAtom(metadata, '\xA9ART', tags.artist);
	if(tags.album)
		addDataAtom(metadata, '\xA9alb', tags.album);
	if(tags.genre)
		addDataAtom(metadata, '\xA9gen', tags.genre);
	
	if(tags.cover){
		var cover = addDataAtom(metadata, 'covr');
		
		cover.data = new jDataView(new Uint8Array(8));
		cover.data.writeUint32(13);
		cover.data = this.concatBuffers(cover.data, new jDataView(tags.cover));
	}
	
	
	var offset = (metadata.parent.parent.getByteLength());
	var stco = mp4.ensureChild('moov.trak.mdia.minf.stbl.stco');

	stco.data.seek(8);
	while(stco.data.tell() < stco.data.byteLength){
		var current = offset + stco.data.getUint32();
		stco.data.skip(-4);
		stco.data.writeUint32(current);
	}

	return mp4;
};
