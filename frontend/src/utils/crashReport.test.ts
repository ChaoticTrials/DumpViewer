import { describe, it, expect } from 'vitest';
import { parseCrashReport } from './crashReport';

// These tests lock in the behaviour parseCrashReport had while it lived inside
// CrashReportViewer.tsx, so moving it into utils/ cannot change what users see.

const REPORT = [
  '---- Minecraft Crash Report ----',
  '// Who set us up the TNT?',
  '',
  'Time: 2024-01-01 10:00:00',
  'Description: Exception in server tick loop',
  '',
  'java.lang.NullPointerException: Cannot invoke "Level.getBlock()" because "level" is null',
  '\tat net.minecraft.server.MinecraftServer.tickServer(MinecraftServer.java:920)',
  '\tat net.minecraft.server.MinecraftServer.runServer(MinecraftServer.java:750)',
].join('\n');

describe('parseCrashReport', () => {
  it('extracts the description and the exception from a realistic report', () => {
    expect(parseCrashReport(REPORT)).toEqual({
      description: 'Exception in server tick loop',
      exception: 'java.lang.NullPointerException: Cannot invoke "Level.getBlock()" because "level" is null',
    });
  });

  it('returns empty strings when there is nothing to find', () => {
    expect(parseCrashReport('just some text\nand more text')).toEqual({ description: '', exception: '' });
  });

  it('returns empty strings for empty content', () => {
    expect(parseCrashReport('')).toEqual({ description: '', exception: '' });
  });

  it('trims the description and tolerates leading whitespace on the line', () => {
    const { description } = parseCrashReport('   Description:    Ticking entity   \n');
    expect(description).toBe('Ticking entity');
  });

  it('lets the last Description line win', () => {
    const content = ['Description: first', 'Description: second'].join('\n');
    expect(parseCrashReport(content).description).toBe('second');
  });

  it('collects a multi-line exception up to the first stack frame', () => {
    const content = [
      'Description: Ticking entity',
      '',
      'java.lang.RuntimeException: outer failure',
      'Caused by: java.lang.IllegalStateException: inner failure',
      '\tat net.minecraft.Foo.bar(Foo.java:1)',
    ].join('\n');

    expect(parseCrashReport(content).exception).toBe(
      'java.lang.RuntimeException: outer failure\nCaused by: java.lang.IllegalStateException: inner failure',
    );
  });

  it('stops collecting at a blank line', () => {
    const content = ['Description: Ticking entity', 'java.lang.RuntimeException: outer failure', '', 'trailing note'].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.RuntimeException: outer failure');
  });

  it('stops collecting at a Stacktrace: marker', () => {
    const content = ['Description: Ticking entity', 'java.lang.RuntimeException: outer failure', 'Stacktrace:', 'x'].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.RuntimeException: outer failure');
  });

  it('collects at most five continuation lines', () => {
    const content = ['Description: Ticking entity', 'java.lang.RuntimeException: outer failure', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'].join(
      '\n',
    );
    const { exception } = parseCrashReport(content);
    expect(exception.split('\n')).toEqual(['java.lang.RuntimeException: outer failure', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('keeps the first exception when several appear', () => {
    const content = [
      'Description: Ticking entity',
      'java.lang.RuntimeException: first',
      '\tat Foo.bar',
      'java.lang.IllegalStateException: second',
    ].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.RuntimeException: first');
  });

  it('ignores an exception that appears before the description', () => {
    const content = ['java.lang.RuntimeException: too early', '', 'Description: Ticking entity'].join('\n');
    expect(parseCrashReport(content)).toEqual({ description: 'Ticking entity', exception: '' });
  });

  it('does not recognise an exception whose class name starts with an uppercase letter and has a message', () => {
    const content = ['Description: Ticking entity', 'NullPointerException: boom'].join('\n');
    expect(parseCrashReport(content).exception).toBe('');
  });

  it('recognises a bare exception class name with no message', () => {
    const content = ['Description: Ticking entity', 'java.lang.NullPointerException'].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.NullPointerException');
  });

  it('recognises an Error as well as an Exception', () => {
    const content = ['Description: Ticking entity', 'java.lang.StackOverflowError: too deep'].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.StackOverflowError: too deep');
  });

  it('trims indentation off the collected exception lines', () => {
    const content = ['Description: Ticking entity', '  java.lang.RuntimeException: outer', '  Caused by: something'].join('\n');
    expect(parseCrashReport(content).exception).toBe('java.lang.RuntimeException: outer\nCaused by: something');
  });
});
