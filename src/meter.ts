// packets
// https://github.com/syssi/esphome-atorch-dl24/blob/main/components/atorch_dl24/button/__init__.py#L12

// BLE Service
const UUID_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
// BLE Notify
const UUID_NOTIFY = "0000ffe1-0000-1000-8000-00805f9b34fb";

class Meter {
    private device: BluetoothDevice | null = null;
    running: boolean = false;
    private characteristic: BluetoothRemoteGATTCharacteristic | null;
    onDisconnectCallback: EventListener | null;
    onStartCallback: ((device: BluetoothDevice) => void) | null;
    onPacketCallback: ((p: Packet, evt: Event) => void) | null;

    constructor() {
        this.characteristic = null;
        // callbacks for UI
        this.onDisconnectCallback = null;
        this.onStartCallback = null;
        this.onPacketCallback = null;
    }

    async onDisconnect(event: Event) {
        // Object event.target is Bluetooth Device getting disconnected.
        var device = event.target as BluetoothDevice;
        this.running = false;
        console.log('> Bluetooth Device disconnected', device.name, device.id);
        if (this.onDisconnectCallback) {
            this.onDisconnectCallback(event);
        }
    }

    async handleCharacteristicValueChanged(event: Event) {
        // https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic
        //console.log("handleCharacteristicValueChanged event:", event);
        const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
        if (!characteristic.value) {
            console.error(`got empty characteristic`);
            return;
        }
        //console.log('Received ', buf2hex(value.buffer));
        try {
            var p = new Packet(characteristic.value);
        } catch (e) {
            console.error("got bad packet", e);
            return;
        }
        console.log(`got packet: ${p.string()}`);
        if (this.onPacketCallback) {
            this.onPacketCallback(p, event);
        }
    }

    async disconnect() {
        console.log('Disconnecting from Bluetooth Device...');
        if (this.characteristic) {
            await this.characteristic.stopNotifications();
        }
        if (this.device && this.device.gatt && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        } else {
            console.log('> Bluetooth Device is already disconnected');
        }
    }

    async start(device: BluetoothDevice) {
        if (this.running) {
            console.error("meter already running");
            return;
        }
        this.device = device;
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect.bind(this));
        if (!this.device.gatt) {
            throw new Error("bluetooth device has no gatt!");
        }
        // Attempts to connect to remote GATT Server.
        return this.device.gatt.connect()
            .then(server => {
                //console.log("server: ", server);
                return server.getPrimaryService(UUID_SERVICE);
            })
            .then(service => {
                //console.log("service:", service);
                return service.getCharacteristic(UUID_NOTIFY);
            })
            .then(characteristic => {
                this.characteristic = characteristic;
                return characteristic.startNotifications();
            })
            .then(characteristic => {
                characteristic.addEventListener('characteristicvaluechanged',
                    this.handleCharacteristicValueChanged.bind(this));
                console.log('Notifications have been started.');
                this.running = true;
                // TODO: sometimes need to press button to start receiving data.
                // TODO: automate by sending command, via timeout?
                if (this.onStartCallback && this.device) {
                    this.onStartCallback(this.device);
                }
            });
    }

    async sendPacket(packet: Uint8Array) {
        if (!this.characteristic) {
            console.error("can't send if no characteristic!");
            return;
        }
        console.log("sending packet:", packet);
        return this.characteristic.writeValueWithoutResponse(packet);
    }

    async reset(): Promise<void> {
        if (!this.running) {
            console.error("can't reset if not running!");
            return;
        }
        var packet = hex2packet(resetPacketHex);
        return await this.sendPacket(packet)
    }

}

// given a hex string, returns a packet
// does not set checksum
function hex2packet(hex: string): Uint8Array {
    var packet = new Uint8Array(hex.replaceAll('.', '').match(/[\da-f]{2}/gi)!.map(function (h) {
        return parseInt(h, 16)
    }));
    return packet;
}

// https://stackoverflow.com/questions/40031688/javascript-arraybuffer-to-hex
function buf2hex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('.');
}

const resetPacketEnergyHex   = 'FF.55.11.01.01.00.00.00.00.57';
const resetPacketCapacityHex = 'FF.55.11.01.02.00.00.00.00.50';
const resetPacketRuntimeHex  = 'FF.55.11.01.03.00.00.00.00.51';
const resetPacketHex         = 'FF.55.11.01.05.00.00.00.00.53';
const plusPacketHex          = 'FF.55.11.01.11.00.00.00.00.67';
const minusPacketHex         = 'FF.55.11.01.12.00.00.00.00.60';
const setupPacketHex         = 'FF.55.11.01.31.00.00.00.00.07';
const enterPacketHex         = 'FF.55.11.01.32.00.00.00.00.00';
const usbPlusPacketHex       = 'FF.55.11.03.33.00.00.00.00.03';
const usbMinusPacketHex      = 'FF.55.11.03.34.00.00.00.00.0c';

/*
example packet:
ff-55-01-03-00-02-07-00-00-00-00-02-7b-00-00-02-3c-00-0b-00-0a-00-17-00-01-31-1e-3c-0c-80-00-00-03-20-00-d1
00-01-02-03-04-05-06-07-08-09-10-11-12-13-14-15-16-17-18-19-20-21-22-23-24-25-26-27-28-29-30-31-32-33-34-35
00-01: Header
      02: Msg Type
         03: device type
            04-05-06: Voltage
                     07-08-09: Amps
                               10-11-12: Ah
                                       13-14-15-16: Wh
                                                   17-18: Data 1 (-)
                                                         19-20: Data 2 (+)
                                                               21-22: Temp (C)
                                                                     23-24: Hours
                                                                           25: Minutes
                                                                              26: Seconds
                                                                                 27: backlightTime
                                                                                    28-29: Over Voltage Protection Setting
                                                                                          30-31: Under Voltage Protection Setting
                                                                                                32-33: Over Current Protection Setting
                                                                                                      34: ?????
                                                                                                         35: CRC
00-01-02-03-04-05-06-07-08-09-10-11-12-13-14-15-16-17-18-19-20-21-22-23-24-25-26-27-28-29-30-31-32-33-34-35
*/

interface PacketDuration {
    hour: number;
    minute: number;
    second: number;
}

// offset 0
const START_OF_FRAME_BYTE1 = 0xFF;
// offset 1
const START_OF_FRAME_BYTE2 = 0x55;

// offset 2
enum MESSAGE {
    REPORT = 0x01,
    REPLY = 0x02,
    COMMAND = 0x11,
}

// offset 3
enum DEVICE_TYPE {
    AC = 0x01,
    DC = 0x02,
    USB = 0x03,
}

const REPORT_PACKET_LEN = 36;

class Packet {
    // allow indexing packet class by string
    [key: string]: any

    // packet fields
    msg: MESSAGE;
    msg_name: string;
    type: DEVICE_TYPE;
    type_name: string;
    voltage: number;
    current: number;
    power: number;
    resistance: number;
    capacity: number;
    energy: number;
    temp: number;
    duration: string;
    backlightTime: number;
    time: Date;
    over_voltage_protection: number;
    lower_voltage_protection: number;
    over_current_protection: number;
    duration_raw: PacketDuration;
    data1: number | null = null;
    data2: number | null = null;

    constructor(data: DataView) {
        if (data.byteLength < 2 || data.getUint8(0) != START_OF_FRAME_BYTE1 || data.getUint8(1) != START_OF_FRAME_BYTE2) {
            var e = new Error(`unexpected header: ${data}`);
            console.error(e);
            throw e;
        }
        if (data.byteLength != REPORT_PACKET_LEN) {
            var e = new Error(`invalid packet length: ${data}`);
            console.error(e);
            throw e;
        }

        this.msg = data.getUint8(2);
        this.msg_name = MESSAGE[this.msg];

        if (this.msg != MESSAGE.REPORT) {
            var e = new Error(`"unexpected message type: ${this.msg}, ${this.msg_name}`);
            console.error(e);
            throw e;
        }

        this.type = data.getUint8(3);
        this.type_name = DEVICE_TYPE[this.type];

        if (this.type == DEVICE_TYPE.DC) {
            this.voltage = data.getUint24(4) / 10; // volts
            this.current = data.getUint24(7) / 1000; // amps
            this.capacity = data.getUint24(10) * 10; // mAh
            this.energy = 0; // Wh

        }
        else {
            this.voltage = data.getUint24(4) / 100; // volts
            this.current = data.getUint24(7) / 100; // amps
            this.capacity = data.getUint24(10); // mAh
            console.log("energy RAW reading: ", data.getUint32(13));
            this.energy = data.getUint32(13) / 100; // Wh
            console.log("energy value: ", data.getUint32(13)/100);
        }

        this.power = Math.round(100 * this.voltage * this.current) / 100; // W
        this.resistance = Math.round(100 * this.voltage / this.current) / 100; // resistance 
        
        // other types untested
        if (this.type == DEVICE_TYPE.USB) {
            this.data1 = data.getUint16(17) / 100; // D-
            this.data2 = data.getUint16(19) / 100; // D+
        }

        if (this.type == DEVICE_TYPE.DC) {
            this.temp = data.getUint16(24); // Temp (C)
        }
        else {
            this.temp = data.getUint16(21); // Temp (C)
        }

        if (this.type == DEVICE_TYPE.DC) {
            this.duration_raw = {
                hour: data.getUint16(26),
                minute: data.getUint8(28),
                second: data.getUint8(29),
            }; 
        }
        else {
            this.duration_raw = {
                hour: data.getUint16(23),
                minute: data.getUint8(25),
                second: data.getUint8(26),
            }; 
        }

        this.duration = Packet.durationString(this.duration_raw);

        this.backlightTime = data.getUint8(27);

        this.time = new Date();

        // settings
        this.over_voltage_protection = data.getUint16(28) / 100;
        this.lower_voltage_protection = data.getUint16(30) / 100;
        this.over_current_protection = data.getUint16(32) / 100;

        // checksum
        // p.checksum = data.getUint8(35);
        // const payload = new Uint8Array(data.buffer.slice(2, -1));
        // console.log("payload for crc", buf2hex(payload));
        // const checksum = payload.reduce((acc, item) => (acc + item) & 0xff, 0) ^ 0x44;
        // p.checksum_valid = (p.checksum == checksum);
        //p.checksum_valid = Packet.validateChecksum(data.buffer);
    }

    string(): string {
        return `[${this.time.toLocaleString()}] ${this.voltage.toFixed(2)}V ${this.current.toFixed(2)}A ${this.temp}°C ${this.capacity}mAh ${this.energy.toFixed(5)}Wh (${this.duration})`;
    }

    static durationString(duration: PacketDuration): string {
        return `${Packet.pad(duration.hour, 3)}:${Packet.pad(duration.minute, 2)}:${Packet.pad(duration.second, 2)}`
    }

    static pad(s: number, n: number): string {
        return String(s).padStart(n, '0');
    }

    // https://github.com/NiceLabs/atorch-console/blob/master/docs/protocol-design.md#checksum-algorithm
    // TODO: can't seem to get this to work with the packets I receive
    // https://jsfiddle.net/3xmv6u0b/95/
    // https://github.com/NiceLabs/atorch-console/blob/master/src/service/atorch-packet/packet-meter-usb.spec.ts
    static validateChecksum(buffer: ArrayBuffer): boolean {
        const packet = new Uint8Array(buffer);
        console.log("validateChecksum in: ", buf2hex(buffer));
        console.log("validateChecksum packet: ", buf2hex(packet));
        const payload = packet.slice(2, -1);
        const checksum = payload.reduce((acc, item) => (acc + item) & 0xff, 0) ^ 0x44;
        const checksum_packet = packet[packet.length - 1]
        var result = checksum_packet == checksum;
        if (!result) {
            console.error(`checksum failure, got ${checksum.toString(16)}, expected ${checksum_packet.toString(16)}`);
        }
        return result;
    }
}


// add getUint24() to DataView type
interface DataView {
    getUint24(pos: number): number
}

DataView.prototype.getUint24 = function (pos: number): number {
    var val1 = this.getUint16(pos);
    var val2 = this.getUint8(pos + 2);
    return (val1 << 8) | val2;
}
