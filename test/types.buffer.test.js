'use strict';

/**
 * Module dependencies.
 */

const start = require('./common');

const assert = require('assert');
const mongoose = require('./common').mongoose;

const MongooseBuffer = mongoose.Types.Buffer;
const Schema = mongoose.Schema;

function valid(v) {
  return !v || v.length > 10;
}

// Dont put indexed models on the default connection, it
// breaks index.test.js tests on a "pure" default conn.
// mongoose.model('UserBuffer', UserBuffer);

/**
 * Test.
 */

describe('types.buffer', function() {
  let subBuf;
  let UserBuffer;
  let db;

  before(function() {
    db = start();

    subBuf = new Schema({
      name: String,
      buf: { type: Buffer, validate: [valid, 'valid failed'], required: true }
    });

    UserBuffer = new Schema({
      name: String,
      serial: Buffer,
      array: [Buffer],
      required: { type: Buffer, required: true, index: true },
      sub: [subBuf]
    });
  });

  after(function(done) {
    db.close(done);
  });

  beforeEach(() => db.deleteModel(/.*/));
  afterEach(() => require('./util').clearTestData(db));
  afterEach(() => require('./util').stopRemainingOps(db));

  it('test that a mongoose buffer behaves and quacks like a buffer', function() {
    let a = new MongooseBuffer;

    assert.ok(a instanceof Buffer);
    assert.ok(a.isMongooseBuffer);
    assert.equal(true, Buffer.isBuffer(a));

    a = new MongooseBuffer([195, 188, 98, 101, 114]);
    const b = new MongooseBuffer('buffer shtuffs are neat');
    const c = new MongooseBuffer('aGVsbG8gd29ybGQ=', 'base64');
    const d = new MongooseBuffer(0);

    assert.equal(a.toString('utf8'), 'über');
    assert.equal(b.toString('utf8'), 'buffer shtuffs are neat');
    assert.equal(c.toString('utf8'), 'hello world');
    assert.equal(d.toString('utf8'), '');
  });

  it('buffer validation', function(done) {
    const User = db.model('Test', UserBuffer);

    User.on('index', function() {
      const t = new User({
        name: 'test validation'
      });

      t.validate(function(err) {
        assert.ok(err.message.indexOf('Test validation failed') === 0, err.message);
        assert.equal(err.errors.required.kind, 'required');
        t.required = { x: [20] };
        t.save(function(err) {
          assert.ok(err);
          assert.equal(err.name, 'ValidationError');
          assert.equal(err.errors.required.name, 'CastError');
          assert.equal(err.errors.required.kind, 'Buffer');
          assert.equal(err.errors.required.message, 'Cast to Buffer failed for value "{ x: [ 20 ] }" (type Object) at path "required"');
          assert.deepEqual(err.errors.required.value, { x: [20] });
          t.required = Buffer.from('hello');

          t.sub.push({ name: 'Friday Friday' });
          t.save(function(err) {
            assert.ok(err.message.indexOf('Test validation failed') === 0, err.message);
            assert.equal(err.errors['sub.0.buf'].kind, 'required');
            t.sub[0].buf = Buffer.from('well well');
            t.save(function(err) {
              assert.ok(err.message.indexOf('Test validation failed') === 0, err.message);
              assert.equal(err.errors['sub.0.buf'].kind, 'user defined');
              assert.equal(err.errors['sub.0.buf'].message, 'valid failed');

              t.sub[0].buf = Buffer.from('well well well');
              t.validate(function(err) {
                assert.ifError(err);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('buffer storage', function(done) {
    const User = db.model('Test', UserBuffer);

    User.on('index', function() {
      const sampleBuffer = Buffer.from([123, 223, 23, 42, 11]);

      const tj = new User({
        name: 'tj',
        serial: sampleBuffer,
        required: Buffer.from(sampleBuffer)
      });

      tj.save(function(err) {
        assert.ifError(err);
        User.find({}, function(err, users) {
          assert.ifError(err);
          assert.equal(users.length, 1);
          const user = users[0];
          const base64 = sampleBuffer.toString('base64');
          assert.equal(base64,
            user.serial.toString('base64'), 'buffer mismatch');
          assert.equal(base64,
            user.required.toString('base64'), 'buffer mismatch');
          done();
        });
      });
    });
  });

  it('test write markModified', function(done) {
    const User = db.model('Test', UserBuffer);

    User.on('index', function() {
      const sampleBuffer = Buffer.from([123, 223, 23, 42, 11]);

      const tj = new User({
        name: 'tj',
        serial: sampleBuffer,
        required: sampleBuffer
      });

      tj.save(function(err) {
        assert.ifError(err);

        tj.serial.write('aa', 1, 'ascii');
        assert.equal(true, tj.isModified('serial'));

        tj.save(function(err) {
          assert.ifError(err);

          User.findById(tj._id, function(err, user) {
            assert.ifError(err);

            const expectedBuffer = Buffer.from([123, 97, 97, 42, 11]);

            assert.equal(expectedBuffer.toString('base64'),
              user.serial.toString('base64'), 'buffer mismatch');

            assert.equal(false, tj.isModified('required'));
            tj.serial.copy(tj.required, 1);
            assert.equal(true, tj.isModified('required'));
            assert.equal('e3thYSo=', tj.required.toString('base64'));

            function not(tj) {
              assert.equal(false, tj.isModified('required'));
            }

            function is(tj) {
              assert.equal(true, tj.isModified('required'));
            }

            // buffer method tests
            const fns = {
              writeUInt8: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt8(0x3, 0, 'big');
                is(tj);
              },
              writeUInt16: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt16(0xbeef, 0, 'little');
                is(tj);
              },
              writeUInt16LE: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt16LE(0xbeef, 0);
                is(tj);
              },
              writeUInt16BE: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt16BE(0xbeef, 0);
                is(tj);
              },
              writeUInt32: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt32(0xfeedface, 0, 'little');
                is(tj);
              },
              writeUInt32LE: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt32LE(0xfeedface, 0);
                is(tj);
              },
              writeUInt32BE: function() {
                reset(tj);
                not(tj);
                tj.required.writeUInt32BE(0xfeedface, 0);
                is(tj);
              },
              writeInt8: function() {
                reset(tj);
                not(tj);
                tj.required.writeInt8(-5, 0, 'big');
                is(tj);
              },
              writeInt16: function() {
                reset(tj);
                not(tj);
                tj.required.writeInt16(0x0023, 2, 'little');
                is(tj);
                assert.equal(tj.required[2], 0x23);
                assert.equal(tj.required[3], 0x00);
              },
              writeInt16LE: function() {
                reset(tj);
                not(tj);
                tj.required.writeInt16LE(0x0023, 2);
                is(tj);
                assert.equal(tj.required[2], 0x23);
                assert.equal(tj.required[3], 0x00);
              },
              writeInt16BE: function() {
                reset(tj);
                not(tj);
                tj.required.writeInt16BE(0x0023, 2);
                is(tj);
              },
              writeInt32: function() {
                reset(tj);
                not(tj);
                tj.required.writeInt32(0x23, 0, 'big');
                is(tj);
                assert.equal(tj.required[0], 0x00);
                assert.equal(tj.required[1], 0x00);
                assert.equal(tj.required[2], 0x00);
                assert.equal(tj.required[3], 0x23);
                tj.required = Buffer.alloc(8);
              },
              writeInt32LE: function() {
                tj.required = Buffer.alloc(8);
                reset(tj);
                not(tj);
                tj.required.writeInt32LE(0x23, 0);
                is(tj);
              },
              writeInt32BE: function() {
                tj.required = Buffer.alloc(8);
                reset(tj);
                not(tj);
                tj.required.writeInt32BE(0x23, 0);
                is(tj);
                assert.equal(tj.required[0], 0x00);
                assert.equal(tj.required[1], 0x00);
                assert.equal(tj.required[2], 0x00);
                assert.equal(tj.required[3], 0x23);
              },
              writeFloat: function() {
                tj.required = Buffer.alloc(16);
                reset(tj);
                not(tj);
                tj.required.writeFloat(2.225073858507201e-308, 0, 'big');
                is(tj);
                assert.equal(tj.required[0], 0x00);
                assert.equal(tj.required[1], 0x0f);
                assert.equal(tj.required[2], 0xff);
                assert.equal(tj.required[3], 0xff);
                assert.equal(tj.required[4], 0xff);
                assert.equal(tj.required[5], 0xff);
                assert.equal(tj.required[6], 0xff);
                assert.equal(tj.required[7], 0xff);
              },
              writeFloatLE: function() {
                tj.required = Buffer.alloc(16);
                reset(tj);
                not(tj);
                tj.required.writeFloatLE(2.225073858507201e-308, 0);
                is(tj);
              },
              writeFloatBE: function() {
                tj.required = Buffer.alloc(16);
                reset(tj);
                not(tj);
                tj.required.writeFloatBE(2.225073858507201e-308, 0);
                is(tj);
              },
              writeDoubleLE: function() {
                tj.required = Buffer.alloc(8);
                reset(tj);
                not(tj);
                tj.required.writeDoubleLE(0xdeadbeefcafebabe, 0);
                is(tj);
              },
              writeDoubleBE: function() {
                tj.required = Buffer.alloc(8);
                reset(tj);
                not(tj);
                tj.required.writeDoubleBE(0xdeadbeefcafebabe, 0);
                is(tj);
              },
              fill: function() {
                tj.required = Buffer.alloc(8);
                reset(tj);
                not(tj);
                tj.required.fill(0);
                is(tj);
                for (let i = 0; i < tj.required.length; i++) {
                  assert.strictEqual(tj.required[i], 0);
                }
              },
              set: function() {
                reset(tj);
                not(tj);
                tj.required[0] = 1;
                tj.markModified('required');
                is(tj);
              }
            };

            const keys = Object.keys(fns);
            let i = keys.length;

            while (i--) {
              const key = keys[i];
              if (Buffer.prototype[key]) {
                fns[key]();
              }
            }
            done();
          });
        });
      });
    });

    function reset(model) {
      // internal
      model.$__.activePaths.clear('modify');
      model.schema.requiredPaths().forEach(function(path) {
        model.$__.activePaths.require(path);
      });
    }
  });

  it('can be set to null', function(done) {
    const User = db.model('Test', UserBuffer);
    const user = new User({ array: [null], required: Buffer.alloc(1) });
    user.save(function(err, doc) {
      assert.ifError(err);
      User.findById(doc, function(err, doc) {
        assert.ifError(err);
        assert.equal(doc.array.length, 1);
        assert.equal(doc.array[0], null);
        done();
      });
    });
  });

  it('can be updated to null', function(done) {
    const User = db.model('Test', UserBuffer);
    const user = new User({ array: [null], required: Buffer.alloc(1), serial: Buffer.alloc(1) });
    user.save(function(err, doc) {
      assert.ifError(err);
      User.findOneAndUpdate({ _id: doc.id }, { serial: null }, { new: true }, function(err, doc) {
        assert.ifError(err);
        assert.equal(doc.serial, null);
        done();
      });
    });
  });

  describe('#toObject', function() {
    it('retains custom subtypes', function() {
      const buf = new MongooseBuffer(0);
      const out = buf.toObject(2);
      // validate the drivers Binary type output retains the option
      assert.equal(out.sub_type, 2);
    });
  });

  describe('subtype', function() {
    let bufferSchema, B;

    beforeEach(function() {
      bufferSchema = new Schema({ buf: Buffer });
      B = db.model('Test', bufferSchema);
    });

    it('default value', function() {
      const b = new B({ buf: Buffer.from('hi') });
      assert.strictEqual(0, b.buf._subtype);
    });

    it('method works', function() {
      const b = new B({ buf: Buffer.from('hi') });
      b.buf.subtype(128);
      assert.strictEqual(128, b.buf._subtype);
    });

    it('is stored', function(done) {
      const b = new B({ buf: Buffer.from('hi') });
      b.buf.subtype(128);
      b.save(function(err) {
        if (err) {
          done(err);
          return;
        }
        B.findById(b, function(err, doc) {
          if (err) {
            done(err);
            return;
          }
          assert.equal(doc.buf._subtype, 128);
          done();
        });
      });
    });

    it('changes are retained', function(done) {
      const b = new B({ buf: Buffer.from('hi') });
      b.buf.subtype(128);
      b.save(function(err) {
        if (err) {
          done(err);
          return;
        }
        B.findById(b, function(err, doc) {
          if (err) {
            done(err);
            return;
          }
          assert.equal(doc.buf._subtype, 128);
          doc.buf.subtype(0);
          doc.save(function(err) {
            if (err) {
              done(err);
              return;
            }
            B.findById(b, function(err, doc) {
              if (err) {
                done(err);
                return;
              }
              assert.strictEqual(0, doc.buf._subtype);
              done();
            });
          });
        });
      });
    });

    it('cast from number (gh-3764)', function() {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: 9001 });
      assert.equal(doc.buf.length, 1);
    });

    it('cast from string', function() {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: 'hi' });
      assert.ok(doc.buf instanceof Buffer);
      assert.equal(doc.buf.toString('utf8'), 'hi');
    });

    it('cast from array', function() {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: [195, 188, 98, 101, 114] });
      assert.ok(doc.buf instanceof Buffer);
      assert.equal(doc.buf.toString('utf8'), 'über');
    });

    it('cast from Binary', function() {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: new MongooseBuffer.Binary([228, 189, 160, 229, 165, 189], 0) });
      assert.ok(doc.buf instanceof Buffer);
      assert.equal(doc.buf.toString('utf8'), '你好');
    });

    it('cast from json (gh-6863)', function() {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: { type: 'Buffer', data: [103, 104, 45, 54, 56, 54, 51] } });
      assert.ok(doc.buf instanceof Buffer);
      assert.equal(doc.buf.toString('utf8'), 'gh-6863');
    });

    it('is an `instanceof Buffer`', () => {
      const schema = new Schema({ buf: Buffer });
      mongoose.deleteModel(/Test/);
      const MyModel = mongoose.model('Test', schema);

      const doc = new MyModel({ buf: { type: 'Buffer', data: [103, 104, 45, 54, 56, 54, 51] } });
      assert.ok(doc.buf instanceof Buffer);
    });
  });
});
