'use strict';

const start = require('./common');

const assert = require('assert');

const mongoose = start.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

describe('schema.onthefly', function() {
  let DecoratedSchema;
  let db;

  before(function() {
    DecoratedSchema = new Schema({
      title: String
    }, { strict: false });

    db = start();
  });

  after(function(done) {
    db.close(done);
  });

  beforeEach(() => db.deleteModel(/.*/));
  afterEach(() => require('./util').clearTestData(db));
  afterEach(() => require('./util').stopRemainingOps(db));

  it('setting should cache the schema type and cast values appropriately', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const post = new Decorated();
    post.set('adhoc', '9', Number);
    assert.equal(post.get('adhoc').valueOf(), 9);
    done();
  });

  it('should be local to the particular document', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const postOne = new Decorated();
    postOne.set('adhoc', '9', Number);
    assert.notStrictEqual(postOne.$__path('adhoc'), undefined);

    const postTwo = new Decorated();
    assert.notStrictEqual(postTwo.$__path('title'), undefined);
    assert.strictEqual(undefined, postTwo.$__path('adhoc'));
    done();
  });

  it('querying a document that had an on the fly schema should work', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const post = new Decorated({ title: 'AD HOC' });
    // Interpret adhoc as a Number
    post.set('adhoc', '9', Number);
    assert.equal(post.get('adhoc').valueOf(), 9);
    post.save(function(err) {
      assert.ifError(err);
      assert.strictEqual(null, err);
      Decorated.findById(post.id, function(err, found) {
        assert.strictEqual(null, err);
        assert.equal(found.get('adhoc'), 9);
        // Interpret adhoc as a String instead of a Number now
        assert.equal(found.get('adhoc', String), '9');
        assert.equal(found.get('adhoc'), '9');

        // set adhoc as an Object
        found.set('adhoc', '3', Object);
        assert.equal(typeof found.get('adhoc'), 'string');
        found.set('adhoc', 3, Object);
        assert.equal(typeof found.get('adhoc'), 'number');

        found.set('adhoc', ['hello'], Object);
        assert.ok(Array.isArray(found.get('adhoc')));
        found.set('adhoc', ['hello'], {});
        assert.ok(Array.isArray(found.get('adhoc')));

        found.set('adhoc', 3, String);
        assert.equal(typeof found.get('adhoc'), 'string');
        found.set('adhoc', 3, Object);
        assert.equal(typeof found.get('adhoc'), 'number');
        done();
      });
    });
  });

  it('on the fly Embedded Array schemas should cast properly', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const post = new Decorated();
    post.set('moderators', [{ name: 'alex trebek' }], [new Schema({ name: String })]);
    assert.equal(post.get('moderators')[0].name, 'alex trebek');
    done();
  });

  it('on the fly Embedded Array schemas should get from a fresh queried document properly', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const post = new Decorated();
    const ModeratorSchema = new Schema({ name: String, ranking: Number });

    post.set('moderators', [{ name: 'alex trebek', ranking: '1' }], [ModeratorSchema]);
    assert.equal(post.get('moderators')[0].name, 'alex trebek');
    post.save(function(err) {
      assert.ifError(err);
      Decorated.findById(post.id, function(err, found) {
        assert.ifError(err);
        const rankingPreCast = found.get('moderators')[0].ranking;
        assert.equal(rankingPreCast, 1);
        assert.strictEqual(undefined, rankingPreCast.increment);
        let rankingPostCast = found.get('moderators', [ModeratorSchema])[0].ranking;
        assert.equal(rankingPostCast, 1);

        const NewModeratorSchema = new Schema({ name: String, ranking: String });
        rankingPostCast = found.get('moderators', [NewModeratorSchema])[0].ranking;
        assert.equal(rankingPostCast, 1);
        done();
      });
    });
  });

  it('casts on get() (gh-2360)', function(done) {
    const Decorated = db.model('Test', DecoratedSchema);

    const d = new Decorated({ title: '1' });
    assert.equal(typeof d.get('title', Number), 'number');

    d.title = '000000000000000000000001';
    assert.equal(d.get('title', ObjectId).constructor.name, 'ObjectId');

    d.set('title', 1, Number);
    assert.equal(typeof d.get('title'), 'number');

    done();
  });
});
